// lib/email-validate.ts
// Server-side "is this a real, reachable email?" check — beyond format, it rejects
// disposable/placeholder domains and requires the domain to actually accept mail
// (has MX records). No email is sent; it's a fast DNS lookup.
import { promises as dns } from "node:dns";

const FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Common placeholder / example / disposable (throwaway) mail domains.
const BLOCKED_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "test.test",
  "email.com",
  "domain.com",
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "grr.la",
  "sharklasers.com",
  "10minutemail.com",
  "10minutemail.net",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "throwawaymail.com",
  "trashmail.com",
  "getnada.com",
  "nada.email",
  "maildrop.cc",
  "dispostable.com",
  "fakeinbox.com",
  "mailnesia.com",
  "mintemail.com",
  "mohmal.com",
  "emailondeck.com",
  "moakt.com",
  "tempinbox.com",
  "spam4.me",
]);

export async function validateCustomerEmail(
  raw: string
): Promise<{ ok: boolean; reason?: string }> {
  const email = (raw ?? "").trim().toLowerCase();
  if (!FORMAT.test(email)) {
    return { ok: false, reason: "Please enter a valid email address." };
  }
  const domain = email.split("@")[1] ?? "";
  if (domain.length < 3 || !domain.includes(".")) {
    return { ok: false, reason: "Please enter a valid email address." };
  }
  if (BLOCKED_DOMAINS.has(domain)) {
    return {
      ok: false,
      reason:
        "Please use a real, monitored email address — placeholder and disposable addresses aren't accepted.",
    };
  }
  // The domain must be able to receive mail (MX records present).
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx || mx.length === 0 || mx.every((r) => !r.exchange)) {
      return {
        ok: false,
        reason: "That email domain can't receive mail — please check the address.",
      };
    }
  } catch {
    return {
      ok: false,
      reason: "We couldn't verify that email domain — please check the address.",
    };
  }
  return { ok: true };
}
