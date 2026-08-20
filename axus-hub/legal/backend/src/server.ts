import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { mkdir } from "node:fs/promises";
import { config } from "./config.js";
import { migrate } from "./db.js";
import { healthRoutes } from "./routes/health.js";
import { envelopeRoutes } from "./routes/envelopes.js";
import { contactRoutes } from "./routes/contacts.js";
import { companyRoutes } from "./routes/companies.js";
import { quoteRoutes } from "./routes/quotes.js";
import { signRoutes } from "./routes/sign.js";
import { registerStatic } from "./static.js";

async function main() {
  await mkdir(config.storageDir, { recursive: true });

  // bodyLimit raised for signature images (data-URL PNGs) in the sign payload.
  const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 25 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });

  await app.register(healthRoutes);
  await app.register(envelopeRoutes, { prefix: "/api/envelopes" });
  await app.register(contactRoutes, { prefix: "/api/contacts" });
  await app.register(companyRoutes, { prefix: "/api/companies" });
  await app.register(quoteRoutes, { prefix: "/api/quotes" });
  await app.register(signRoutes, { prefix: "/api/sign" });
  registerStatic(app, config.frontendDir);

  await migrate();
  await app.listen({ host: "0.0.0.0", port: config.port });
  app.log.info(`Axus Legal API listening on :${config.port}`);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
