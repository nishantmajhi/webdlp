/**
 * The set of yt-dlp options this application is willing to run.
 *
 * Everything here exists because yt-dlp is not a program you can safely hand
 * arbitrary flags to. `--exec` runs a shell command after each download;
 * `--config-location` loads a file that may itself contain `--exec`;
 * `--batch-file` and `--load-info-json` read any file the process can read; and
 * `-o` / `--paths` write anywhere it can write. The request used to be trusted
 * to name its own flags, which meant anyone who could reach the server could run
 * commands on it.
 *
 * Deno's `--allow-run=yt-dlp` does not help with that. It restricts which binary
 * *this* program may launch; `--exec` makes yt-dlp do the launching.
 *
 * So the contract is inverted: the client may ask for options from this list and
 * nothing else, and every value is checked against a pattern or a fixed set. The
 * list mirrors exactly what static/index.html offers, and the two should be
 * changed together.
 */

/** How one accepted option may be used. */
type OptionSpec =
  /** A bare flag. Sending a value with it is a rejection, not a silent drop. */
  | { kind: "flag" }
  /** A value from a fixed set. */
  | { kind: "enum"; values: readonly string[] }
  /** A value matching a pattern, with a description used in the error message. */
  | { kind: "pattern"; pattern: RegExp; describe: string };

export const ALLOWED_OPTIONS: Readonly<Record<string, OptionSpec>> = {
  // Mode
  "--extract-audio": { kind: "flag" },

  // Quality and container. The value sets mirror the <select> elements in
  // static/index.html; a format string is not accepted freehand because
  // yt-dlp's format syntax is expressive enough to be worth constraining.
  "--format": {
    kind: "enum",
    values: [
      "best",
      "bestvideo[height<=1080]+bestaudio",
      "bestvideo[height<=720]+bestaudio",
      "bestvideo[height<=480]+bestaudio",
    ],
  },
  "--audio-format": { kind: "enum", values: ["mp3", "m4a", "flac", "best"] },
  "--merge-output-format": { kind: "enum", values: ["mp4", "mkv", "webm"] },

  // Playlist handling
  "--no-playlist": { kind: "flag" },
  "--yes-playlist": { kind: "flag" },
  "--playlist-items": {
    kind: "pattern",
    // Ranges and lists as yt-dlp accepts them: "1", "1-5", "1,3,7-9".
    pattern: /^\d{1,4}(-\d{1,4})?(,\d{1,4}(-\d{1,4})?)*$/,
    describe: "item numbers such as 1, 1-5 or 1,3,7-9",
  },

  // Embedding
  "--embed-chapters": { kind: "flag" },
  "--embed-metadata": { kind: "flag" },
  "--embed-subs": { kind: "flag" },
  "--embed-thumbnail": { kind: "flag" },
  "--write-subs": { kind: "flag" },

  // SponsorBlock
  "--sponsorblock-mark": {
    kind: "enum",
    values: ["all", "sponsor", "intro", "outro", "selfpromo", "interaction"],
  },
  "--sponsorblock-remove": {
    kind: "enum",
    values: ["all", "sponsor", "intro", "outro", "selfpromo", "interaction"],
  },

  // Transfer behaviour
  "--continue": { kind: "flag" },
  "--no-continue": { kind: "flag" },
  "--no-overwrites": { kind: "flag" },
  "--geo-bypass": { kind: "flag" },
  "--prefer-free-formats": { kind: "flag" },
  "--limit-rate": {
    kind: "pattern",
    // "500K", "1.5M", "2G", or a plain byte count.
    pattern: /^\d{1,9}(\.\d{1,3})?[KMG]?$/,
    describe: "a rate such as 500K, 1.5M or 2G",
  },
  "--retries": {
    kind: "pattern",
    pattern: /^\d{1,3}$/,
    describe: "a whole number of retries",
  },
  "--concurrent-fragments": {
    kind: "pattern",
    pattern: /^\d{1,2}$/,
    describe: "a whole number of fragments",
  },
  "--age-limit": {
    kind: "pattern",
    pattern: /^\d{1,3}$/,
    describe: "an age in years",
  },

  // Output verbosity
  "--quiet": { kind: "flag" },
  "--verbose": { kind: "flag" },
  "--no-warnings": { kind: "flag" },
} as const;

export interface YtDlpOption {
  arg: string;
  value?: string;
}

export type SanitiseResult =
  | { ok: true; options: YtDlpOption[] }
  | { ok: false; error: string };

/** The most options a single request may carry. */
export const MAX_OPTIONS = 40;

/**
 * Check a client-supplied option list against the allowlist.
 *
 * Returns the accepted options, or the first reason one was refused. Refusing
 * the whole request rather than dropping the offending entry is deliberate: a
 * request carrying an option this server does not understand is not a request
 * it should half-perform.
 */
export function sanitiseOptions(raw: unknown): SanitiseResult {
  if (raw === null || raw === undefined) {
    return { ok: true, options: [] };
  }

  if (!Array.isArray(raw)) {
    return { ok: false, error: "options must be an array" };
  }

  if (raw.length > MAX_OPTIONS) {
    return { ok: false, error: `at most ${MAX_OPTIONS} options may be given` };
  }

  const accepted: YtDlpOption[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, error: "each option must be an object" };
    }

    const { arg, value } = entry as Record<string, unknown>;

    if (typeof arg !== "string") {
      return { ok: false, error: "each option needs an 'arg' string" };
    }

    const spec = Object.prototype.hasOwnProperty.call(ALLOWED_OPTIONS, arg)
      ? ALLOWED_OPTIONS[arg]
      : undefined;

    if (spec === undefined) {
      return { ok: false, error: `option ${arg} is not allowed` };
    }

    // Sending the same flag twice is a sign the caller is confused, and for
    // valued options it makes the effective value depend on argument order.
    if (seen.has(arg)) {
      return { ok: false, error: `option ${arg} was given more than once` };
    }
    seen.add(arg);

    if (spec.kind === "flag") {
      if (value !== undefined && value !== null && value !== "") {
        return { ok: false, error: `option ${arg} does not take a value` };
      }

      accepted.push({ arg });
      continue;
    }

    if (typeof value !== "string" || value === "") {
      return { ok: false, error: `option ${arg} requires a value` };
    }

    if (spec.kind === "enum") {
      if (!spec.values.includes(value)) {
        return { ok: false, error: `option ${arg} does not accept "${value}"` };
      }
    } else if (!spec.pattern.test(value)) {
      return { ok: false, error: `option ${arg} expects ${spec.describe}` };
    }

    accepted.push({ arg, value });
  }

  return { ok: true, options: accepted };
}

/**
 * Whether a string is a URL yt-dlp should be asked to fetch.
 *
 * Only http and https. Without this a "URL" beginning with a dash is read by
 * yt-dlp as another option, and schemes such as file: would ask it to read from
 * the local disk.
 */
export function isDownloadableUrl(candidate: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  // A hostname is required; "http:///path" parses but names no host.
  return parsed.hostname.length > 0;
}
