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
import type { DownloadSummary, YtDlpOption } from "./src/downloadService.ts";
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
    await Deno.writeTextFile(COOKIE_PATH, cookieText);
    return json({ success: true });
  } catch (err) {
    return json({
      error: `Could not save cookie file: ${err instanceof Error ? err.message : String(err)}`,
    }, 500);
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

  let options: YtDlpOption[] | null = null;
  if (optionsParam) {
    try {
      options = JSON.parse(optionsParam);
    } catch {
      options = null; // fall through without options, same as the original
    }
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
      return serveStaticFile(join(STATIC_ROOT, "index.html"));
    }
    if (
      pathname === "/favicon.ico" ||
      pathname.startsWith("/css/") ||
      pathname.startsWith("/js/")
    ) {
      // pathname is already URL-decoded and always starts with "/"
      return serveStaticFile(join(STATIC_ROOT, pathname.slice(1)));
    }
  }

  return new Response("Not found", { status: 404 });
}

const port = Number(Deno.env.get("APP_PORT") ?? "5476");

console.log(`webdlp listening on http://0.0.0.0:${port}`);
Deno.serve({ port, hostname: "0.0.0.0" }, router);
