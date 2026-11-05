import Fastify from "fastify";
import { config } from "./config.js";
import { migrate } from "./db.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { entryRoutes } from "./routes/entries.js";
import { workerRoutes } from "./routes/workers.js";
import { registerStatic } from "./static.js";

async function main() {
  const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 1 * 1024 * 1024 });

  await app.register(healthRoutes);
  await app.register(meRoutes);
  await app.register(entryRoutes, { prefix: "/api/entries" });
  await app.register(workerRoutes, { prefix: "/api/workers" });
  registerStatic(app, config.frontendDir);

  await migrate();
  await app.listen({ host: "0.0.0.0", port: config.port });
  app.log.info(`Axus Time Reporting API listening on :${config.port}`);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
