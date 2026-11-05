// Central config, all from env (with sane dev defaults).
export const config = {
  port: Number(process.env.PORT ?? 8000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://axus:axus@localhost:5432/atrs",
  platformDomain: process.env.PLATFORM_DOMAIN ?? "hub.axustechnologies.com",
  // Public origin for building links in emails.
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "https://atrs.axustechnologies.com",
  // Built SPA to serve (relative to the backend working dir in the container).
  frontendDir: process.env.FRONTEND_DIR ?? "public",
  mail: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    // What recipients SEE in the From line.
    from: process.env.MAIL_FROM ?? "Axus Time Reporting <no-reply@axustechnologies.com>",
    // Envelope MAIL FROM / bounce address = the authenticated mailbox.
    sender: process.env.MAIL_SENDER ?? process.env.SMTP_USER ?? "support@axustechnologies.com",
    // Who gets notified when a contractor submits time for approval. Defaults to
    // the Axus team inbox; override with ATRS_APPROVER_EMAIL.
    approverTo: process.env.ATRS_APPROVER_EMAIL ?? "info@axustechnologies.com",
  },
  // Dev-only identity fallback when not behind the Authentik forward-auth proxy.
  dev: {
    email: process.env.DEV_USER_EMAIL,
    name: process.env.DEV_USER_NAME ?? "Dev User",
    groups: process.env.DEV_USER_GROUPS ?? "app-atrs|atrs-role-admin",
  },
} as const;
