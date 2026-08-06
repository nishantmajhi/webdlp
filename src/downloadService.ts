// downloadService.ts
//
// Equivalent of Services/DownloadService.cs. Spawns yt-dlp via Deno.Command
// (requires --allow-run), streams stdout/stderr line-by-line into a
// per-download progress queue that the SSE /progress endpoint drains, and
// moves finished files from downloads/temp into downloads/.
//
// Playlist URLs (see --yes-playlist in the frontend) make a single yt-dlp
// invocation produce many output files and, potentially, many per-item
// failures (age-restricted/region-blocked/deleted videos, etc). We always
// pass --ignore-errors so one bad item doesn't abort the rest of the
// playlist, collect every per-item ERROR line as it streams past, and move
// every file that did get produced - not just the first one. Once the run
// finishes we push a single "summary:{...}" message with counts and the
// list of skipped items, so the frontend can show what failed *after*
// everything else has finished downloading instead of stopping partway
// through.

import { basename, extname, join } from "node:path";
import type { DatabaseService } from "./db.ts";

export interface YtDlpOption {
  arg: string;
  value?: string;
}

/** A single playlist/video item that yt-dlp reported as a hard error on. */
export interface FailedItem {
  extractor?: string;
  videoId?: string;
  message: string;
}

export interface DownloadSummary {
  succeeded: number;
  failed: FailedItem[];
}

export const APP_ROOT = Deno.cwd();
export const COOKIE_PATH = join(APP_ROOT, "cookie.txt");

/**
 * Parses a yt-dlp "ERROR: ..." line into a structured item.
 *
 * yt-dlp's usual shapes are:
 *   ERROR: [youtube] dQw4w9WgXcQ: Video unavailable
 *   ERROR: [youtube] Sign in to confirm your age
 *   ERROR: Unable to download webpage: HTTP Error 403
 *
 * The video id is only captured when it directly follows the "[extractor]"
 * tag (yt-dlp's actual format), so we never accidentally slice a word out
 * of the middle of a free-form error message.
 */
function parseErrorLine(line: string): FailedItem | null {
  const withId = /^ERROR:\s*\[([^\]]+)\]\s+([\w.-]+):\s*(.+)$/.exec(line);
  if (withId) {
    return { extractor: withId[1], videoId: withId[2], message: withId[3].trim() };
  }

  const withExtractor = /^ERROR:\s*\[([^\]]+)\]\s*(.+)$/.exec(line);
  if (withExtractor) {
    return { extractor: withExtractor[1], message: withExtractor[2].trim() };
  }

  const plain = /^ERROR:\s*(.+)$/.exec(line);
  if (plain) {
    return { message: plain[1].trim() };
  }

  return null;
}

export class DownloadService {
  // Messages waiting to be sent over SSE, per download id.
  #progressQueues = new Map<string, string[]>();
  // Full transcript per download id (not drained), so /error can inspect
  // what actually went wrong after the SSE stream reports "error".
  #outputLogs = new Map<string, string[]>();
  // Every file that ended up in downloads/ for this id, in the order they
  // were moved (a playlist can produce many).
  #downloadedFiles = new Map<string, string[]>();
  // Every per-item ERROR yt-dlp reported for this id, collected as the
  // process runs and reported all at once once it's done.
  #failedItems = new Map<string, FailedItem[]>();

  getProgressQueue(id: string): string[] {
    let queue = this.#progressQueues.get(id);
    if (!queue) {
      queue = [];
      this.#progressQueues.set(id, queue);
    }
    return queue;
  }

  getFilePaths(id: string): string[] {
    return this.#downloadedFiles.get(id) ?? [];
  }

  /** Used for the "we already downloaded this exact URL" cache-hit fast path. */
  setFilePaths(id: string, paths: string[]): void {
    this.#downloadedFiles.set(id, paths);
  }

  #addFilePath(id: string, path: string): void {
    const list = this.#downloadedFiles.get(id);
    if (list) {
      list.push(path);
    } else {
      this.#downloadedFiles.set(id, [path]);
    }
  }

  #recordIfError(id: string, line: string): void {
    const parsed = parseErrorLine(line);
    if (!parsed) return;

    let list = this.#failedItems.get(id);
    if (!list) {
      list = [];
      this.#failedItems.set(id, list);
    }
    // The same failure can be printed on both stdout and stderr - don't
    // list it twice.
    const isDupe = list.some(
      (f) => f.message === parsed.message && f.videoId === parsed.videoId,
    );
    if (!isDupe) list.push(parsed);
  }

  /** Pushes the end-of-run summary (counts + skipped items) as a single SSE message. */
  #sendSummary(id: string, succeededCount: number): void {
    const summary: DownloadSummary = {
      succeeded: succeededCount,
      failed: this.#failedItems.get(id) ?? [],
    };
    this.addProgress(id, `summary:${JSON.stringify(summary)}`);
  }

  getErrorLog(id: string): string {
    const lines = this.#outputLogs.get(id) ?? [];
    return lines
      .filter((l) => l !== "done" && l !== "error" && !l.startsWith("summary:"))
      .join("\n");
  }

  addProgress(id: string, message: string): void {
    this.getProgressQueue(id).push(message);

    let log = this.#outputLogs.get(id);
    if (!log) {
      log = [];
      this.#outputLogs.set(id, log);
    }
    log.push(message);
  }

  async startDownload(
    url: string,
    id: string,
    db: DatabaseService,
    options?: YtDlpOption[] | null,
  ): Promise<void> {
    const tempDir = join(APP_ROOT, "downloads", "temp");
    const downloadsDir = join(APP_ROOT, "downloads");
    await Deno.mkdir(tempDir, { recursive: true });
    await Deno.mkdir(downloadsDir, { recursive: true });

    // Fresh slate for this attempt (a retry of the same id shouldn't carry
    // over failures/files from a previous click).
    this.#failedItems.set(id, []);
    this.#downloadedFiles.set(id, []);

    const outputTemplate = join(tempDir, `${id}_%(title)s.%(ext)s`);

    const buildArgs = (): string[] => {
      const args = [
        url,
        "-o",
        outputTemplate,
        "--newline",
        // Keep going past individual video failures (age-restricted,
        // region-blocked, deleted, private, etc.) instead of aborting the
        // whole playlist. Failures are collected via #recordIfError as
        // they stream past and reported together once everything else has
        // finished - see #sendSummary.
        "--ignore-errors",
      ];

      if (options && options.length > 0) {
        for (const option of options) {
          args.push(option.arg);
          if (option.value) args.push(option.value);
        }
      }

      try {
        const cookieStat = Deno.statSync(COOKIE_PATH);
        if (cookieStat.isFile && cookieStat.size > 0) {
          args.push("--cookies", COOKIE_PATH);
        }
      } catch {
        // no cookie file yet, nothing to add
      }

      return args;
    };

    try {
      const args = buildArgs();
      const { code } = await this.#runYtDlp(args, id);

      let movedCount = await this.#moveDownloadedFiles(id, tempDir, downloadsDir, url, db);

      // Only fall back to the "update yt-dlp and retry once" recovery when
      // nothing was produced AND nothing was reported as a per-item error
      // either - i.e. the original single-video edge case where yt-dlp
      // claimed success but no file showed up. If we already know *why*
      // things failed (real per-item errors), retrying blindly won't help.
      if (movedCount === 0 && code === 0 && (this.#failedItems.get(id)?.length ?? 0) === 0) {
        this.addProgress(
          id,
          "Download failed. Updating yt-dlp in the background and retrying...",
        );
        await this.#runYtDlp(["-U"], id);

        this.addProgress(id, "yt-dlp updated. Retrying download...");
        const retry = await this.#runYtDlp(args, id);
        if (retry.code === 0) {
          movedCount = await this.#moveDownloadedFiles(id, tempDir, downloadsDir, url, db);
        }
      }

      this.#sendSummary(id, movedCount);

      // A playlist where some items failed but at least one file came
      // through still counts as "done" - the summary above lists what to
      // follow up on, but the user shouldn't be blocked from grabbing what
      // did succeed.
      this.addProgress(id, movedCount > 0 ? "done" : "error");
    } catch (err) {
      this.addProgress(id, `Error: ${err instanceof Error ? err.message : String(err)}`);
      this.#sendSummary(id, this.getFilePaths(id).length);
      this.addProgress(id, "error");
    }
  }

  /** Runs yt-dlp with the given args, streaming every stdout/stderr line into the progress log. */
  async #runYtDlp(args: string[], id: string): Promise<{ code: number }> {
    const command = new Deno.Command("yt-dlp", {
      args,
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    const pump = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (value) {
            buffered += decoder.decode(value, { stream: true });
            const lines = buffered.split(/\r\n|\r|\n/);
            buffered = lines.pop() ?? "";
            for (const line of lines) {
              if (line.length === 0) continue;
              this.addProgress(id, line);
              this.#recordIfError(id, line);
            }
          }
          if (done) {
            if (buffered.length > 0) {
              this.addProgress(id, buffered);
              this.#recordIfError(id, buffered);
            }
            break;
          }
        }
      } finally {
        reader.releaseLock();
      }
    };

    await Promise.all([pump(process.stdout), pump(process.stderr)]);
    const status = await process.status;
    return { code: status.code };
  }

  /**
   * Looks for every file yt-dlp produced for this id in tempDir and moves
   * each one into downloadsDir. A single invocation can produce many files
   * when the URL is a playlist, so this moves *all* of them rather than
   * stopping at the first - otherwise everything after item #1 would be
   * silently left behind in temp/. Returns how many files were moved.
   */
  async #moveDownloadedFiles(
    id: string,
    tempDir: string,
    downloadsDir: string,
    url: string,
    db: DatabaseService,
  ): Promise<number> {
    const tempFileNames: string[] = [];
    for await (const entry of Deno.readDir(tempDir)) {
      if (entry.isFile && entry.name.startsWith(`${id}_`)) {
        tempFileNames.push(entry.name);
      }
    }
    // Stable order so a playlist's files land in the order yt-dlp wrote them.
    tempFileNames.sort();

    // Every relative "downloads/..." path moved this run, in order. Recorded
    // in the DB as a whole once the loop finishes (see below) so a playlist
    // URL remembers *all* of its files, not just the first one.
    const movedRelativePaths: string[] = [];

    let movedCount = 0;
    for (const tempFileName of tempFileNames) {
      const tempFilePath = join(tempDir, tempFileName);
      let cleanFileName = tempFileName.slice(tempFileName.indexOf("_") + 1);
      let finalPath = join(downloadsDir, cleanFileName);

      try {
        await Deno.stat(finalPath);
        // File with same name already exists - disambiguate with a timestamp
        // in the same yyyyMMdd_HHmmss shape the original app used.
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const timestamp =
          `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
          `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const ext = extname(cleanFileName);
        const nameWithoutExt = basename(cleanFileName, ext);
        cleanFileName = `${nameWithoutExt}_${timestamp}${ext}`;
        finalPath = join(downloadsDir, cleanFileName);
      } catch {
        // finalPath doesn't exist yet, no collision
      }

      await Deno.rename(tempFilePath, finalPath);
      this.addProgress(id, `File moved to downloads folder: ${cleanFileName}`);
      this.#addFilePath(id, finalPath);
      movedCount++;
      movedRelativePaths.push(join("downloads", cleanFileName));
    }

    if (movedRelativePaths.length > 0) {
      // Record every file this run produced against the URL - not just the
      // first - so a repeat visit to this URL (the cache-hit fast path in
      // main.ts) can serve back the *whole* playlist instead of forgetting
      // everything past item #1.
      db.addDownload(id, url, movedRelativePaths);
    }

    return movedCount;
  }
}
