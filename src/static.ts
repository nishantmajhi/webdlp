// static.ts
//
// Minimal static file helpers - no framework needed for a handful of routes.

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/** Serves a static file by path, 404ing if it doesn't exist. Not range-aware (fine for html/css/js/icons). */
export async function serveStaticFile(filePath: string): Promise<Response> {
  try {
    const data = await Deno.readFile(filePath);
    return new Response(data, {
      headers: { "Content-Type": contentTypeFor(filePath) },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

/**
 * Serves a file as a download, honoring Range requests so large video
 * files can be resumed/streamed (equivalent to enableRangeProcessing: true
 * in the original ASP.NET PhysicalFile call).
 */
export async function serveFileDownload(
  filePath: string,
  fileName: string,
  request: Request,
): Promise<Response> {
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(filePath);
  } catch {
    return new Response("File not found", { status: 404 });
  }

  const encodedFileName = encodeURIComponent(fileName);
  // The plain `filename="..."` fallback has to be a header-safe ByteString:
  // real video/playlist titles routinely contain characters outside
  // Latin-1 (em dashes, curly quotes, emoji, non-Latin scripts, etc.), and
  // handing one of those to the Response constructor unmodified throws
  // ("not a valid ByteString"). That crash used to go uncaught all the way
  // up to Deno's default error handler, which served a generic 500 with no
  // Content-Disposition/Content-Type at all - the browser then had nothing
  // to name the download after but the URL, saving it as "zip.txt" instead
  // of the actual archive. The RFC 5987 `filename*=UTF-8''...` field below
  // still carries the exact original name (percent-encoded, so it's
  // already header-safe) and is what modern browsers actually use to name
  // the saved file; this ASCII version is only the legacy fallback.
  const asciiFileName = fileName
    .replace(/[^\x20-\x7e]/g, "_") // strip anything outside printable ASCII
    .replace(/[\\"]/g, "_"); // and anything that would break the quoting
  const baseHeaders = {
    "Content-Type": "application/octet-stream",
    "Content-Disposition":
      `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`,
    "Accept-Ranges": "bytes",
  };

  const range = request.headers.get("range");
  const file = await Deno.open(filePath, { read: true });

  if (!range) {
    return new Response(file.readable, {
      headers: { ...baseHeaders, "Content-Length": String(stat.size) },
    });
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    file.close();
    return new Response("Invalid range", { status: 416 });
  }

  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;

  if (start >= stat.size || end >= stat.size || start > end) {
    file.close();
    return new Response("Range not satisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${stat.size}` },
    });
  }

  await file.seek(start, Deno.SeekMode.Start);
  const length = end - start + 1;
  const limited = file.readable.pipeThrough(limitStream(length));

  return new Response(limited, {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Length": String(length),
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    },
  });
}

/** Cuts a byte stream off after `limit` bytes. */
function limitStream(limit: number): TransformStream<Uint8Array, Uint8Array> {
  let sent = 0;
  return new TransformStream({
    transform(chunk, controller) {
      if (sent >= limit) return;
      const remaining = limit - sent;
      const piece = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
      controller.enqueue(piece);
      sent += piece.byteLength;
    },
  });
}
