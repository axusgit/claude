// Central config, all from env (with sane dev defaults). APMS is a zero-knowledge
// vault: the server stores only ciphertext and NEVER has the passphrase, the vault
// key, or any plaintext secret. There is therefore no encryption key in this config.
export const config = {
  port: Number(process.env.PORT ?? 8000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://axus:axus@localhost:5432/apms",
  platformDomain: process.env.PLATFORM_DOMAIN ?? "hub.axustechnologies.com",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "https://apms.axustechnologies.com",
  // Built SPA to serve (relative to the backend working dir in the container).
  frontendDir: process.env.FRONTEND_DIR ?? "public",
  // Dev-only identity fallback when not behind the Authentik forward-auth proxy.
  dev: {
    email: process.env.DEV_USER_EMAIL,
    name: process.env.DEV_USER_NAME ?? "Dev User",
    groups: process.env.DEV_USER_GROUPS ?? "app-apms|apms-role-admin",
  },
} as const;
