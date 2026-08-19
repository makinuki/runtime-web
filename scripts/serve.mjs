import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 5173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  const start = Date.now();
  const raw = new URL(req.url ?? "/", `http://${req.headers.host}`).pathname;
  const rel = raw === "/" ? "examples/demo.html" : raw.slice(1);
  const file = normalize(join(ROOT, rel));
  let status = 404;
  let bytes = 0;
  if (!file.startsWith(ROOT) && !file.startsWith(ROOT + sep)) {
    status = 403;
    res.writeHead(403).end("forbidden");
  } else {
    try {
      const body = await readFile(file);
      status = 200;
      bytes = body.byteLength;
      const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type }).end(body);
    } catch {
      status = 404;
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  }
  console.log(`${req.method} ${status} ${Date.now() - start}ms ${bytes}B ${raw}`);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`demo: http://127.0.0.1:${PORT}/ (examples/demo.html)`);
});
