// Central config, all from env (with sane dev defaults).
export const config = {
    port: Number(process.env.PORT ?? 8000),
    databaseUrl: process.env.DATABASE_URL ?? "postgresql://axus:axus@localhost:5432/aesign",
    platformDomain: process.env.PLATFORM_DOMAIN ?? "hub.axustechnologies.com",
    // Public origin for building signer links in emails.
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "https://aesign.axustechnologies.com",
    // Where uploaded originals + sealed PDFs live (a mounted volume in prod).
    storageDir: process.env.STORAGE_DIR ?? "/data/aesign",
    // Built SPA to serve (relative to the backend working dir in the container).
    frontendDir: process.env.FRONTEND_DIR ?? "public",
    // Word/PDF conversion service (containerized LibreOffice). Wired in Wk3.
    gotenbergUrl: process.env.GOTENBERG_URL ?? "http://gotenberg:3000",
    mail: {
        host: process.env.SMTP_HOST ?? "",
        port: Number(process.env.SMTP_PORT ?? 587),
        user: process.env.SMTP_USER ?? "",
        pass: process.env.SMTP_PASS ?? "",
        // Placeholder sender; will change later (kept configurable).
        from: process.env.MAIL_FROM ?? "Axus <support@axustechnologies.com>",
    },
    // Dev-only identity fallback when not behind the Authentik forward-auth proxy.
    dev: {
        email: process.env.DEV_USER_EMAIL,
        name: process.env.DEV_USER_NAME ?? "Dev User",
        groups: process.env.DEV_USER_GROUPS ?? "app-aesign|aesign-role-admin",
    },
};
//# sourceMappingURL=config.js.map