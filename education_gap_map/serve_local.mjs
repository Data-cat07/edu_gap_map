import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const port = Number(process.argv[2] || 8766);

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const rel = pathname === "/" ? "education_gap_korea_tile_map.html" : pathname.replace(/^\//, "");
  const filePath = path.resolve(root, rel);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": filePath.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
    });
    res.end(data);
  });
}).listen(port, "127.0.0.1");
