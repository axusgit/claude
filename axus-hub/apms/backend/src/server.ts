import Fastify from "fastify";
import { config } from "./config.js";
import { migrate } from "./db.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { vaultRoutes } from "./routes/vault.js";
import { folderRoutes } from "./routes/folders.js";
import { itemRoutes } from "./routes/items.js";
import { auditRoutes } from "./routes/audit.js";
import { registerStatic } from "./static.js";

async function main() {
  // Ciphertext blobs (a full CSV import posts many encrypted items) can be large,
  // so allow a generous body limit.
  const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 32 * 1024 * 1024 });

  await app.register(healthRoutes);
  await app.register(meRoutes);
  await app.register(vaultRoutes, { prefix: "/api/vault" });
  await app.register(folderRoutes, { prefix: "/api/folders" });
  await app.register(itemRoutes, { prefix: "/api/items" });
  await app.register(auditRoutes, { prefix: "/api/audit" });
  registerStatic(app, config.frontendDir);

  await migrate();
  await app.listen({ host: "0.0.0.0", port: config.port });
  app.log.info(`Axus Password Management API listening on :${config.port}`);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
