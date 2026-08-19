// Minimal, dependency-free static file server for the built SPA. Registered
// LAST so /api/* routes always win; anything else falls back to index.html
// (client-side routing). Auth is enforced upstream by the Authentik proxy.
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".map": "application/json",
};
export function registerStatic(app, dir) {
    const root = resolve(dir);
    const index = join(root, "index.html");
    app.setNotFoundHandler((req, reply) => {
        // API 404s stay JSON; everything else serves the SPA shell or a static asset.
        if (req.url.startsWith("/api/")) {
            return reply.code(404).send({ error: "Not found" });
        }
        const rel = normalize(req.url.split("?")[0]).replace(/^(\.\.[/\\])+/, "");
        let file = join(root, rel);
        if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
            file = index;
        }
        if (!existsSync(file))
            return reply.code(404).send("Not found");
        reply.header("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
        return reply.send(createReadStream(file));
    });
}
//# sourceMappingURL=static.js.map