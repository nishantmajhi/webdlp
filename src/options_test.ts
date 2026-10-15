import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  ALLOWED_OPTIONS,
  isDownloadableUrl,
  MAX_OPTIONS,
  sanitiseOptions,
} from "./options.ts";

/*
 * These tests are the security boundary for this application. Every dangerous
 * yt-dlp flag named here is one that turns a download request into command
 * execution or arbitrary file access on the host, and each has its own case so
 * that a change to the allowlist which reopens one of them fails loudly.
 */

Deno.test("the flags that make yt-dlp run commands are refused", () => {
  const dangerous = [
    // Runs a shell command after each download.
    { arg: "--exec", value: "calc.exe" },
    { arg: "--exec-before-download", value: "calc.exe" },
    // Loads a config file that may itself contain --exec.
    { arg: "--config-location", value: "/tmp/evil.conf" },
    // Read any file the process can read.
    { arg: "--batch-file", value: "/etc/passwd" },
    { arg: "--load-info-json", value: "/etc/passwd" },
    // Write anywhere the process can write.
    { arg: "-o", value: "/var/www/html/shell.php" },
    { arg: "--output", value: "/var/www/html/shell.php" },
    { arg: "--paths", value: "/var/www/html" },
    // Post-processing hooks that shell out.
    { arg: "--postprocessor-args", value: "-x" },
    { arg: "--downloader", value: "/bin/sh" },
    { arg: "--external-downloader", value: "/bin/sh" },
  ];

  for (const option of dangerous) {
    const result = sanitiseOptions([option]);
    assertFalse(result.ok, `${option.arg} must be refused`);
  }
});

Deno.test("the options the interface offers are accepted", () => {
  const fromTheUi = [
    { arg: "--format", value: "bestvideo[height<=1080]+bestaudio" },
    { arg: "--merge-output-format", value: "mp4" },
    { arg: "--embed-metadata" },
    { arg: "--embed-thumbnail" },
    { arg: "--no-playlist" },
    { arg: "--limit-rate", value: "500K" },
    { arg: "--retries", value: "10" },
    { arg: "--concurrent-fragments", value: "4" },
    { arg: "--sponsorblock-remove", value: "sponsor" },
  ];

  const result = sanitiseOptions(fromTheUi);

  assert(result.ok, "a normal request from the interface is accepted");
  if (result.ok) {
    assertEquals(result.options.length, fromTheUi.length, "every option survives");
  }
});

Deno.test("audio mode options are accepted", () => {
  const result = sanitiseOptions([
    { arg: "--extract-audio" },
    { arg: "--audio-format", value: "mp3" },
  ]);

  assert(result.ok, "audio extraction is accepted");
});

Deno.test("an unknown option is refused rather than dropped", () => {
  const result = sanitiseOptions([
    { arg: "--format", value: "best" },
    { arg: "--not-a-real-option" },
  ]);

  assertFalse(result.ok, "the whole request is refused");
  if (!result.ok) {
    assert(result.error.includes("--not-a-real-option"), "the message names the option");
  }
});

Deno.test("values are checked against the set the interface offers", () => {
  assert(sanitiseOptions([{ arg: "--audio-format", value: "flac" }]).ok, "a listed value");
  assertFalse(
    sanitiseOptions([{ arg: "--audio-format", value: "; calc.exe" }]).ok,
    "an injected value is refused",
  );
  assertFalse(
    sanitiseOptions([{ arg: "--format", value: "best; rm -rf /" }]).ok,
    "a format string carrying a command is refused",
  );
});

Deno.test("patterned values reject anything that is not the shape expected", () => {
  assert(sanitiseOptions([{ arg: "--limit-rate", value: "1.5M" }]).ok, "a rate");
  assert(sanitiseOptions([{ arg: "--playlist-items", value: "1,3,7-9" }]).ok, "an item range");

  for (
    const bad of [
      { arg: "--limit-rate", value: "500K; calc" },
      { arg: "--limit-rate", value: "$(calc)" },
      { arg: "--retries", value: "10 --exec calc" },
      { arg: "--concurrent-fragments", value: "-1" },
      { arg: "--playlist-items", value: "1;calc" },
    ]
  ) {
    assertFalse(sanitiseOptions([bad]).ok, `${bad.value} must be refused`);
  }
});

Deno.test("a flag may not carry a value and a valued option may not be bare", () => {
  assertFalse(
    sanitiseOptions([{ arg: "--embed-metadata", value: "surprise" }]).ok,
    "a flag given a value is refused rather than having the value dropped",
  );

  assertFalse(
    sanitiseOptions([{ arg: "--format" }]).ok,
    "a valued option with no value is refused",
  );
});

Deno.test("repeats are refused", () => {
  assertFalse(
    sanitiseOptions([
      { arg: "--format", value: "best" },
      { arg: "--format", value: "bestvideo[height<=720]+bestaudio" },
    ]).ok,
    "the same option twice is refused, since which one wins depends on order",
  );
});

Deno.test("malformed input is refused", () => {
  assertFalse(sanitiseOptions("--exec calc").ok, "a string instead of an array");
  assertFalse(sanitiseOptions([{ notAnArg: true }]).ok, "an object with no arg");
  assertFalse(sanitiseOptions([null]).ok, "a null entry");
  assertFalse(sanitiseOptions(["--exec"]).ok, "a bare string entry");
  assertFalse(
    sanitiseOptions([{ arg: 123 }]).ok,
    "a non-string arg",
  );
});

Deno.test("absent options are treated as none rather than an error", () => {
  const nothing = sanitiseOptions(null);
  assert(nothing.ok, "null is accepted");
  if (nothing.ok) assertEquals(nothing.options, [], "and yields no options");

  const undef = sanitiseOptions(undefined);
  assert(undef.ok, "undefined is accepted");
});

Deno.test("an absurd number of options is refused", () => {
  const many = Array.from({ length: MAX_OPTIONS + 1 }, () => ({ arg: "--quiet" }));

  assertFalse(sanitiseOptions(many).ok, "the request is refused before it is examined");
});

Deno.test("every allowlisted option has a spec that is actually enforced", () => {
  for (const [arg, spec] of Object.entries(ALLOWED_OPTIONS)) {
    if (spec.kind === "flag") {
      assert(sanitiseOptions([{ arg }]).ok, `${arg} works as a bare flag`);
      continue;
    }

    // A valued option must refuse a value carrying a shell metacharacter.
    assertFalse(
      sanitiseOptions([{ arg, value: "x; calc.exe" }]).ok,
      `${arg} refuses an injected value`,
    );
  }
});

Deno.test("only http and https URLs are downloadable", () => {
  assert(isDownloadableUrl("https://example.com/watch?v=abc"), "https");
  assert(isDownloadableUrl("http://example.com/video"), "http");

  assertFalse(isDownloadableUrl("file:///etc/passwd"), "file scheme");
  assertFalse(isDownloadableUrl("ftp://example.com/x"), "ftp scheme");
  assertFalse(isDownloadableUrl("javascript:alert(1)"), "javascript scheme");
  assertFalse(isDownloadableUrl("--exec"), "a flag rather than a url");
  assertFalse(isDownloadableUrl("-oshell.php"), "an attached flag");
  assertFalse(isDownloadableUrl(""), "empty");
  assertFalse(isDownloadableUrl("not a url"), "not a url");
  assertFalse(isDownloadableUrl("//example.com/x"), "protocol-relative, which has no scheme");

  // Worth recording: the URL parser normalises "http:///nohost" to
  // "http://nohost/", so that is a real http URL and is accepted. The hostname
  // check remains as a guard for anything the parser leaves without one.
  assert(isDownloadableUrl("http:///nohost"), "an empty authority is normalised to a host");
});
