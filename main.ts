// main.ts
//
// Deno/TypeScript replacement for the old .NET Program.cs + Controllers.
// Plain Deno.serve with manual routing - the app only has ~8 routes, so a
// framework would add more weight than it saves.
//
// Run with:
//   deno task start
// or directly:
//   deno run --allow-net --allow-run=yt-dlp --allow-read --allow-write --allow-env --env-file=.env main.ts

import { join } from "node:path";
import { DatabaseService } from "./src/db.ts";
import { APP_ROOT, COOKIE_PATH, DownloadService } from "./src/downloadService.ts";
import type { DownloadSummary } from "./src/downloadService.ts";
import { isDownloadableUrl, sanitiseOptions, type YtDlpOption } from "./src/options.ts";
import { serveFileDownload, serveStaticFile } from "./src/static.ts";
import { createZip, suggestZipName, zipTempPath } from "./src/zip.ts";

const STATIC_ROOT = join(APP_ROOT, "static");
const DB_PATH = join(APP_ROOT, "database", "downloads.sqlite3");

await Deno.mkdir(join(APP_ROOT, "database"), { recursive: true });

const db = new DatabaseService(DB_PATH);
db.initialize();

const downloadService = new DownloadService();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function handleCookieStatus(): Promise<Response> {
  try {
    const stat = await Deno.stat(COOKIE_PATH);
    return json({ hasCookie: stat.isFile && stat.size > 0 });
  } catch {
    return json({ hasCookie: false });
  }
}

async function handleSaveCookie(request: Request): Promise<Response> {
  let body: { cookieText?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const cookieText = body.cookieText;
  if (!cookieText || cookieText.trim().length === 0) {
    return json({ error: "Cookie text cannot be empty." }, 400);
  }

  if (!cookieText.trimStart().toLowerCase().startsWith("# netscape http cookie file")) {
    return json(
      {
        error: "This does not look like a valid Netscape cookie file. " +
          "Make sure you exported it with the correct browser extension.",
      },
      400,
    );
  }

  try {
    // This file holds live session cookies for whatever sites the person
    // exported them from — they are account credentials, not preferences. The
    // mode keeps them readable only by the user the service runs as. It has no
    // effect on Windows, where the containing directory's permissions govern.
    await Deno.writeTextFile(COOKIE_PATH, cookieText, { mode: 0o600 });
    return json({ success: true });
  } catch {
    // The underlying message names absolute paths; it goes to the log, not to
    // the caller.
    console.error("could not write the cookie file");
    return json({ error: "Could not save the cookie file." }, 500);
  }
}

async function handleDeleteCookie(): Promise<Response> {
  try {
    await Deno.remove(COOKIE_PATH);
  } catch {
    // already gone - fine
  }
  return json({ success: true });
}

async function handleDownload(url: URL): Promise<Response> {
  const videoUrl = url.searchParams.get("url");
  const id = url.searchParams.get("id");
  const optionsParam = url.searchParams.get("options");

  if (!videoUrl || !id) {
    return new Response("URL and ID are required", { status: 400 });
  }

  // yt-dlp is asked to fetch this. Anything that is not plainly an http(s) URL
  // is refused rather than passed along: a value beginning with a dash would be
  // read as another option, and a file: URL would ask it to read local disk.
  if (!isDownloadableUrl(videoUrl)) {
    return new Response("Only http and https URLs can be downloaded", { status: 400 });
  }

  // Options are checked against the allowlist in src/options.ts. They used to be
  // passed through verbatim, which let a caller name flags such as --exec and
  // run commands on this machine.
  let options: YtDlpOption[] = [];
  if (optionsParam) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(optionsParam);
    } catch {
      return new Response("options is not valid JSON", { status: 400 });
    }

    const sanitised = sanitiseOptions(parsed);

    if (!sanitised.ok) {
      return new Response(sanitised.error, { status: 400 });
    }

    options = sanitised.options;
  }

  const existing = db.getDownloadByUrl(videoUrl);
  if (existing && existing.filePaths.length > 0) {
    // A playlist URL can have many cached files - check every one (not
    // just the first) rather than silently dropping items #2+ from a
    // previous run, which was the original bug: all playlist videos really
    // were downloaded and were sitting right here on disk, but the app had
    // only ever remembered the first one and had no way to hand back the
    // rest on a repeat visit to the same URL.
    const existingFiles: string[] = [];
    for (const relativePath of existing.filePaths) {
      const absolutePath = join(APP_ROOT, relativePath);
      try {
        await Deno.stat(absolutePath);
        existingFiles.push(absolutePath);
      } catch {
        // This particular cached file is gone (manually deleted, etc.) -
        // skip it but still serve back whatever else is still there.
      }
    }

    if (existingFiles.length > 0) {
      downloadService.addProgress(
        id,
        `${existingFiles.length} file(s) already exist from previous download (${existing.downloadedAt})`,
      );
      downloadService.addProgress(id, "Preparing existing file(s) for download...");
      downloadService.setFilePaths(id, existingFiles);

      // Send the same "summary:{...}" shape a fresh download would, so the
      // frontend shows every cached file (and offers the zip download) just
      // like it would right after a real run, instead of only ever
      // presenting file #1.
      const summary: DownloadSummary = { succeeded: existingFiles.length, failed: [] };
      downloadService.addProgress(id, `summary:${JSON.stringify(summary)}`);
      downloadService.addProgress(id, "done");
      return new Response(null, { status: 200 });
    }

    downloadService.addProgress(
      id,
      `Warning: This URL was previously downloaded on ${existing.downloadedAt} but no cached files were found. Downloading again...`,
    );
  }

  // Fire and forget - progress streams over SSE via /progress.
  downloadService.startDownload(videoUrl, id, db, options);

  return new Response(null, { status: 200 });
}

function handleProgress(url: URL, signal: AbortSignal): Response {
  const id = url.searchParams.get("id");
  if (!id) return new Response("id is required", { status: 400 });

  const queue = downloadService.getProgressQueue(id);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        while (!signal.aborted) {
          if (queue.length > 0) {
            const message = queue.shift()!;
            controller.enqueue(encoder.encode(`data: ${message}\n\n`));
            if (message === "done" || message === "error") break;
          } else {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      } catch {
        // client disconnected mid-stream - nothing to do
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

async function handleFile(url: URL, request: Request): Promise<Response> {
  const id = url.searchParams.get("id");
  if (!id) return new Response("ID is required", { status: 400 });

  // A playlist download can produce more than one file; index picks which
  // one (see GET /files for the list). Defaults to the first, so existing
  // single-video callers keep working unchanged.
  const indexParam = url.searchParams.get("index");
  const index = indexParam ? Number(indexParam) : 0;

  const filePath = downloadService.getFilePaths(id)[index];
  if (!filePath) return new Response("File not found", { status: 404 });

  const fileName = filePath.split(/[\\/]/).pop() ?? "download";
  return await serveFileDownload(filePath, fileName, request);
}

/** Lists every file a (possibly multi-item) download produced, for the "Save" buttons. */
function handleFiles(url: URL): Response {
  const id = url.searchParams.get("id");
  if (!id) return new Response("id is required", { status: 400 });

  const files = downloadService.getFilePaths(id).map((filePath, index) => ({
    index,
    fileName: filePath.split(/[\\/]/).pop() ?? "download",
  }));
  return json({ files });
}

/**
 * Bundles every file a (playlist) download produced into a single .zip and
 * serves that instead of making the person click through one "Save" button
 * per video. Single-file downloads fall through to the plain file download
 * so a normal video doesn't get needlessly wrapped in an archive.
 */
async function handleZip(url: URL, request: Request): Promise<Response> {
  const id = url.searchParams.get("id");
  if (!id) return new Response("id is required", { status: 400 });

  const filePaths = downloadService.getFilePaths(id);
  if (filePaths.length === 0) return new Response("File not found", { status: 404 });

  if (filePaths.length === 1) {
    const filePath = filePaths[0];
    const fileName = filePath.split(/[\\/]/).pop() ?? "download";
    return await serveFileDownload(filePath, fileName, request);
  }

  const entries = filePaths.map((filePath) => ({
    path: filePath,
    name: filePath.split(/[\\/]/).pop() ?? "file",
  }));

  const zipPath = zipTempPath(APP_ROOT, id);
  try {
    await Deno.stat(zipPath);
  } catch {
    // Not built yet (or was cleared) - build it once; repeat clicks and
    // Range-resumed downloads reuse this same file.
    await createZip(entries, zipPath);
  }

  return await serveFileDownload(zipPath, suggestZipName(entries), request);
}

function handleError(url: URL): Response {
  const id = url.searchParams.get("id");
  if (!id) return new Response("id is required", { status: 400 });
  return new Response(downloadService.getErrorLog(id), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function router(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  // --- API routes -----------------------------------------------------
  if (pathname === "/cookie/status" && method === "GET") return handleCookieStatus();
  if (pathname === "/cookie" && method === "POST") return handleSaveCookie(request);
  if (pathname === "/cookie" && method === "DELETE") return handleDeleteCookie();
  if (pathname === "/download" && method === "GET") return handleDownload(url);
  if (pathname === "/progress" && method === "GET") return handleProgress(url, request.signal);
  if (pathname === "/file" && method === "GET") return handleFile(url, request);
  if (pathname === "/files" && method === "GET") return handleFiles(url);
  if (pathname === "/zip" && method === "GET") return handleZip(url, request);
  if (pathname === "/error" && method === "GET") return handleError(url);

  // --- Static frontend (untouched) -------------------------------------
  if (method === "GET") {
    if (pathname === "/") {
      return serveStaticFile(join(STATIC_ROOT, "index.html"), STATIC_ROOT);
    }
    if (
      pathname === "/favicon.ico" ||
      pathname.startsWith("/css/") ||
      pathname.startsWith("/js/")
    ) {
      // pathname is already URL-decoded and always starts with "/"
      return serveStaticFile(join(STATIC_ROOT, pathname.slice(1)), STATIC_ROOT);
    }
  }

  return new Response("Not found", { status: 404 });
}

const port = Number(Deno.env.get("APP_PORT") ?? "5476");

/**
 * Listen on the loopback interface unless told otherwise.
 *
 * This used to be "0.0.0.0" unconditionally, which put an unauthenticated
 * service that spawns processes on every interface of whatever network the
 * machine was attached to. There is still no authentication, so exposing it
 * has to be a deliberate act: set APP_HOST=0.0.0.0 to do it, and put something
 * in front of it that asks who is calling.
 *
 * Inside Docker the container's own loopback is not reachable from the host, so
 * the compose file sets APP_HOST=0.0.0.0 and publishes the port on 127.0.0.1
 * instead, which puts the boundary at the host rather than in the container.
 */
const hostname = Deno.env.get("APP_HOST") ?? "127.0.0.1";

if (hostname !== "127.0.0.1" && hostname !== "localhost") {
  console.warn(
    `webdlp is listening on ${hostname}, which is reachable from other machines. ` +
      `It has no authentication and can run yt-dlp on this host.`,
  );
}

console.log(`webdlp listening on http://${hostname}:${port}`);
Deno.serve({ port, hostname }, router);
