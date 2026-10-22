import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// A local demo host, not a public production deployment.
export function serveFrontend(root, port = 5173) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405);
        res.end();
        return;
      }
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const relay =
        pathname === "/tide_dpop_auth.html" ||
        pathname.startsWith("/tide_dpop/");
      let path = resolve(
        base,
        "." + (relay ? "/tide_dpop_auth.html" : pathname),
      );
      if (path !== base && !path.startsWith(base + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        if (!(await stat(path)).isFile()) path = resolve(base, "index.html");
      } catch {
        if (extname(pathname) && !relay) {
          res.writeHead(404);
          res.end();
          return;
        }
        path = resolve(base, "index.html");
      }
      const bytes = await readFile(path);
      res.setHeader(
        "Content-Type",
        mime[extname(path)] || "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (relay) {
        res.setHeader("Allow-CSP-From", "*");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'unsafe-inline'",
        );
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      }
      res.writeHead(200);
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch {
      res.writeHead(500);
      res.end("CareFlow: could not serve the demo.");
    }
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolveServer(server);
    });
  });
}
