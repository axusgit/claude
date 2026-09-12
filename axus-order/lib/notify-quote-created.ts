// lib/notify-quote-created.ts
// Best-effort INTERNAL heads-up to Axus sales the moment a customer generates a
// quote on the open (no-login) site. Deliberately distinct from send-quote-email.ts,
// which fires only when the customer clicks "Talk to Axus about this quote" and
// attaches the PDF + CC's the customer. This notification is internal-only:
//   - to sales (QUOTE_EMAIL_TO), never CC'd to the customer
//   - no PDF attachment (lightweight)
//   - distinct subject so it isn't confused with a "Talk to Axus" request
// It must NEVER block or fail quote creation — callers fire-and-forget and log.
// Bot/junk volume is already curbed upstream: validateCustomerEmail() rejects
// placeholder/disposable/unroutable emails before a quote is ever created.
import { getTransport, MAIL_FROM, QUOTE_EMAIL_TO } from "@/lib/mailer";

export interface QuoteCreatedNotice {
  id: string;
  quoteNumber: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerCompany?: string | null;
  subtotal: number;
  lineCount: number;
  ipAddress?: string | null;
}

export async function notifyQuoteCreated(q: QuoteCreatedNotice): Promise<void> {
  const transport = getTransport();
  if (!transport) return; // mail not configured — nothing to do

  const num = q.quoteNumber ?? q.id;
  const who = q.customerName ?? q.customerEmail ?? "a customer";
  const org = q.customerCompany ? ` (${q.customerCompany})` : "";
  const custEmail = q.customerEmail?.trim();
  const replyTo =
    custEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(custEmail) ? custEmail : undefined;

  await transport.sendMail({
    from: MAIL_FROM,
    to: QUOTE_EMAIL_TO,
    replyTo, // lets sales reply straight to the customer if they want to reach out
    subject: `New quote created — ${num} — ${who}${org}`,
    text:
      `A customer just generated a budgetary quote on Readiness Order.\n` +
      `(Automatic heads-up — the customer has NOT clicked "Talk to Axus" yet.)\n\n` +
      `Quote #: ${num}\n` +
      `Name: ${q.customerName ?? "—"}\n` +
      `Email: ${q.customerEmail ?? "—"}\n` +
      `Organization: ${q.customerCompany ?? "—"}\n` +
      `Line items: ${q.lineCount}\n` +
      `Subtotal (approx.): ~$${Math.round(q.subtotal)}\n` +
      (q.ipAddress ? `IP: ${q.ipAddress}\n` : "") +
      `\nView online: https://rorder.axustechnologies.com/quote/${q.id}\n` +
      `Admin: https://rorder.axustechnologies.com/admin/quotes\n`,
  });
}
