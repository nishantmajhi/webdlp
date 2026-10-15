# webdlp

A browser front end for [yt-dlp](https://github.com/yt-dlp/yt-dlp), so
downloading a video is a URL in a text box rather than a command line with
twenty flags.

Runs locally. Written in Deno with no dependencies beyond the standard library.

---

## What it does

You paste a URL, pick some options, and press Download. The server runs yt-dlp,
streams its progress back to the page as it happens, and offers the finished
file — or, for a playlist, all of them individually or as one zip.

Three things it does that a bare yt-dlp invocation does not:

- **Remembers what it has already fetched.** A URL you downloaded before is
  served from disk rather than fetched again. Playlists remember every file they
  produced, not just the first.
- **Keeps going past a bad item.** One private or region-blocked video in a
  playlist of forty does not abort the other thirty-nine; the failures are
  collected and reported together at the end.
- **Carries cookies when you need them.** Age-restricted or members-only content
  works if you supply an exported cookie file.

---

## Running it

You need [Deno](https://deno.com) and
[yt-dlp](https://github.com/yt-dlp/yt-dlp) on `PATH`. `setup.sh` and `setup.ps1`
install both.

```sh
deno task start      # http://127.0.0.1:5476
```

or:

```sh
docker compose up --detach
```

Other tasks:

```sh
deno task dev        # restart on change
deno task test       # the test suite
deno task check      # type check
```

---

## Where things are

```
main.ts                 Routing and request handling
src/options.ts          The yt-dlp options this server will run, and their values
src/downloadService.ts  Spawning yt-dlp, parsing its output, tracking progress
src/db.ts               The record of what has been downloaded (SQLite)
src/static.ts           Static files and range-aware file downloads
src/zip.ts              Bundling a playlist into one archive
static/                 The page itself
downloads/              Finished files
```

---

## The security model, and why it is shaped this way

This program takes input from a browser and uses it to run another program. That
is the whole design, and it is why the following are not negotiable.

### It listens on localhost

`APP_HOST` defaults to `127.0.0.1`. There is **no authentication** — anyone who
can reach the port can make this machine download things and can read anything
in `downloads/`.

Setting `APP_HOST=0.0.0.0` exposes it to the network and the server prints a
warning when you do. Do not do that without putting something in front of it
that asks who is calling. Under Docker the container listens on `0.0.0.0`
because its own loopback is unreachable from the host, and the compose file
publishes the port on `127.0.0.1` instead, so the boundary is the host.

### Options come from an allowlist, never from the request

`src/options.ts` names every flag this server will pass to yt-dlp and constrains
every value. Anything else is a 400.

This is the most important file in the project. yt-dlp is not a program you can
safely hand arbitrary flags to:

| Flag | What it gives away |
|---|---|
| `--exec` | Runs a shell command after each download |
| `--config-location` | Loads a config file, which may itself contain `--exec` |
| `--batch-file`, `--load-info-json` | Reads any file the process can read |
| `-o`, `--paths` | Writes anywhere the process can write |

Before this existed, the request named its own flags and they were passed
through verbatim. That was remote code execution for anyone who could reach the
port, and Deno's `--allow-run=yt-dlp` did not help: it restricts which binary
*this* program may launch, and `--exec` makes yt-dlp do the launching.

**Adding an option means adding it in two places** — the control in
`static/index.html` and the entry in `ALLOWED_OPTIONS` — and adding a case to
`src/options_test.ts`. If that feels like friction, it is the intended amount.

### The URL is checked and then passed positionally

Only `http` and `https` are accepted, and the URL goes after a `--` separator so
yt-dlp cannot read it as a flag even if the check were wrong. Two independent
reasons a URL beginning with a dash cannot become an option.

### Cookies are credentials

The file uploaded through the cookie panel holds live session cookies for
whatever sites you exported them from. It is written with mode `0600` and there
is a delete button in the interface. Treat it the way you would treat a saved
password, and delete it when you are done.

---

## Testing

```sh
deno task test
```

Thirteen tests, all in `src/options_test.ts`, and they are almost entirely about
refusal: every dangerous yt-dlp flag has its own case, so a change to the
allowlist that reopens one fails the build rather than passing quietly. The
remaining cases cover value patterns, malformed input, and URL scheme checking.

The download pipeline itself is not covered — it needs a real yt-dlp and a real
network — so treat a green suite as "the boundary holds", not "the app works".

---

## Known gaps

- **No authentication.** Localhost-only is the mitigation, not a solution. Any
  process on the machine can drive it.
- **No cap on concurrent downloads.** Each request spawns a yt-dlp process and
  nothing limits how many run at once.
- **`src/downloadService.ts` parses yt-dlp's human-readable output** with three
  regexes to classify errors. That is inherently brittle across yt-dlp versions;
  `--print-json` would be sturdier.
- **Progress lives in memory**, so a restart loses the state of anything running.

## Licence

Free for personal, non-commercial use. You may use, study and modify this
software for yourself, but you may not use it commercially, and you may not
share or publish it, in its original form or modified. See [LICENSE](LICENSE)
for the full terms.
