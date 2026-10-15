# Code Review — webdlp

Original review 2026-09-04. **Updated 2026-09-05 after the fixes on branch
`cleanup/2026-09-05` (unpushed).**

## Status

| # | Finding | State |
|---|---|---|
| 1 | Client-supplied yt-dlp flags passed through verbatim (remote code execution) | **Fixed** |
| 2 | Listening on 0.0.0.0 with no authentication | **Fixed** — localhost by default |
| 3 | Download URL could be read as a flag; no scheme check | **Fixed** |
| 4 | Cookie file written with default permissions | **Fixed** — mode 0600 |
| 5 | Cookie write error returned absolute paths to the caller | **Fixed** |
| 6 | Static file serving relied on two accidents rather than a check | **Fixed** |
| 7 | No authentication at all | **Open** — mitigated by localhost binding |
| 8 | No cap on concurrent downloads | **Open** |
| 9 | yt-dlp output parsed with regexes | **Open** |
| 10 | No tests | **Fixed** — 13 cases covering the boundary |

## Verified against a running server

The exploit and its neighbours were tried against `deno task start` on the fixed
code:

| Attempt | Result |
|---|---|
| `--exec calc.exe` | 400 `option --exec is not allowed` |
| `--config-location /tmp/x` | 400 `option --config-location is not allowed` |
| `-o /shell.php` | 400 `option -o is not allowed` |
| `file:///etc/passwd` as the URL | 400 `Only http and https URLs can be downloaded` |
| `--exec=calc` as the URL | 400 `Only http and https URLs can be downloaded` |
| `--limit-rate "500K; calc"` | 400 `expects a rate such as 500K, 1.5M or 2G` |
| `/css/..%2f..%2fmain.ts` | 404 |
| A normal `--format best` request | 200 |

## What to check first

1. **Run a real download.** I could not: yt-dlp is not installed on this
   machine, so everything downstream of the argument builder is unexercised.
   The option list in `src/options.ts` was derived from the `data-arg`
   attributes in `static/index.html`, so it should match the interface exactly —
   but confirm each control still works, particularly the three paired value
   inputs (limit rate, retries, concurrent fragments).
2. **`docker-compose.yml` now publishes on `127.0.0.1`.** If you were reaching
   this from another machine on purpose, that will stop working, and the fix is
   to put authentication in front of it rather than to revert the line.

## Remaining work, in order

**Authentication.** Localhost-only is a mitigation, not a solution — any process
on the machine can still drive it. A shared token checked on every route would
be enough for a personal tool and is perhaps thirty lines.

**A concurrency cap.** Each request spawns a yt-dlp process with nothing
limiting how many run at once.

**Replace the output parsing.** `src/downloadService.ts` classifies errors with
three regexes over yt-dlp's human-readable output. It is careful work — the
three shapes are documented — but it will break on a yt-dlp release that rewords
a message. `--print-json` gives structured output instead.

## Note on the option allowlist

`src/options.ts` and `static/index.html` have to agree. If you add a control to
the interface and forget the allowlist, the option is silently refused and the
download fails with a 400 the page will show as an error. The test
`every allowlisted option has a spec that is actually enforced` catches the
reverse direction only. A test that parses `data-arg` out of the HTML and
asserts each one is allowlisted would close the loop; worth adding if you
extend the options much.

## Licence, 2026-10-02

The author chose one licence for all of their projects: free for personal,
non-commercial use, modifiable for the user's own use, and not to be
distributed, original or modified. No standard licence says that, so `LICENSE`
is a short custom text, the same in every project apart from the year and what
it excludes. The README's licence section says the same. Anything above that
calls the licence an open question, or calls the project MIT, is superseded.

## CI, 2026-10-02

`.github/workflows/ci.yml` runs `deno task check` and `deno task test` on Deno
2, `ubuntu-latest`. Nothing has been pushed, so it has not run on GitHub yet.
Every job was run before committing, from a fresh clone of this branch, the
way a runner would run it: Linux jobs in a throwaway Ubuntu 24.04 (the image
`ubuntu-latest` uses) with the same tool versions. 13.
