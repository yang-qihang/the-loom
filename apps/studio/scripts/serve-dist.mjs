// E2E 静态服务：serve dist（构建时注入 VITE_E2E/VITE_MOCK），避免 dev server 在并发环境下被误杀。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const root = resolve(process.cwd(), "dist");
const port = Number(process.argv[2] ?? 5186);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    let file = join(root, pathname === "/" ? "index.html" : pathname);
    if (!extname(file)) file = join(root, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    try {
      const body = await readFile(join(root, "index.html"));
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  }
}).listen(port, "127.0.0.1", () => console.log(`[studio-e2e] dist serving on http://127.0.0.1:${port}`));
