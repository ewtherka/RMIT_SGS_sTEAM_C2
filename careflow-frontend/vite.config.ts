import {
  defineConfig,
  type Plugin,
  type ViteDevServer,
  type PreviewServer,
} from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// The exact vendor relay is shared with the backend, never re-created or templated.
const relay = readFileSync(
  new URL("../careflow-backend/public/tide_dpop_auth.html", import.meta.url),
);
const silentSSO = readFileSync(
  new URL(
    "./node_modules/@tidecloak/js/silent-check-sso.html",
    import.meta.url,
  ),
);
function relayPlugin(): Plugin {
  const configure = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((req, res, next) => {
      const path = new URL(req.url || "/", "http://localhost").pathname;
      if (path !== "/tide_dpop_auth.html" && !path.startsWith("/tide_dpop/"))
        return next();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Allow-CSP-From", "*");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'unsafe-inline'",
      );
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.removeHeader("X-Frame-Options");
      res.end(relay);
    });
  };
  return {
    name: "careflow-tide-relay",
    configureServer: configure,
    configurePreviewServer: configure,
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "tide_dpop_auth.html",
        source: relay,
      });
      this.emitFile({
        type: "asset",
        fileName: "silent-check-sso.html",
        source: silentSSO,
      });
    },
  };
}
export default defineConfig({
  plugins: [react(), relayPlugin()],
  build: { target: "es2022" },
});
