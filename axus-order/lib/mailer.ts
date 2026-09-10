// lib/mailer.ts — nodemailer transport over the shared Axus M365 SMTP relay.
import nodemailer, { type Transporter } from "nodemailer";

let cached: Transporter | null = null;

export function getTransport(): Transporter | null {
  if (cached) return cached;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null; // mail not configured
  cached = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: (process.env.SMTP_SECURE ?? "false") === "true",
    auth: { user, pass },
  });
  return cached;
}

export const MAIL_FROM =
  process.env.SMTP_FROM ?? "Axus Readiness Order <support@axustechnologies.com>";
// Where "Talk to Axus about this quote" is delivered.
export const QUOTE_EMAIL_TO = process.env.QUOTE_EMAIL_TO ?? "sales@axustechnologies.com";
