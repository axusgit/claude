// lib/send-quote-email.ts
// Build the quote PDF (on the Axus letterhead) and email it to Axus sales, with the
// customer CC'd and set as reply-to. Records the delivery outcome on the Quote so the
// admin can see status and resend, and so the retry-emails cron can pick up failures.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { DISCLAIMER_TITLE, DISCLAIMER_TEXT } from "@/lib/disclaimer";
import { generateQuotePdf, type QuotePdfData } from "@/lib/quote-pdf";
import { getTransport, MAIL_FROM, QUOTE_EMAIL_TO } from "@/lib/mailer";

export type SendResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

// Synchronous retry schedule (ms between attempts). Kept under ~15s so the HTTP
// request doesn't hang; the retry-emails cron re-tries anything still failing.
const RETRY_DELAYS = [0, 2000, 4000, 8000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendQuoteEmail(id: string): Promise<SendResult> {
  const transport = getTransport();
  if (!transport) {
    return { ok: false, status: 503, error: "Email isn't configured on the server yet." };
  }

  const quote = await prisma.quote.findUnique({
    where: { id },
    include: { lines: { include: { catalogItem: true } } },
  });
  if (!quote) return { ok: false, status: 404, error: "Quote not found." };

  try {
    const data: QuotePdfData = {
      quoteNumber: quote.quoteNumber ?? quote.id,
      customerName: quote.customerName,
      customerEmail: quote.customerEmail,
      customerCompany: quote.customerCompany,
      createdAt: quote.createdAt,
      validUntil: quote.validUntil,
      status: quote.status,
      subtotal: quote.subtotal,
      lines: quote.lines.map((l) => ({
        name: l.usedReplacement ? l.description : l.catalogItem?.internalName ?? l.description,
        sku:
          l.synnexSKU && !/^mock-/i.test(l.synnexSKU) && l.synnexSKU.trim().length >= 4
            ? l.synnexSKU
            : null,
        qty: l.qty,
        unit: l.unitBallpark,
        total: l.lineTotal,
        contact: l.lineTotal == null || l.unitBallpark == null,
        note: l.usedReplacement
          ? `Suggested alternative selected — replaces ${l.originalName ?? "original item"}`
          : null,
      })),
      disclaimerTitle: DISCLAIMER_TITLE,
      disclaimerText: DISCLAIMER_TEXT,
      acceptedName: quote.customerName ?? quote.customerEmail,
      acceptedAt: quote.disclaimerAcceptedAt,
    };

    const letterhead = await readFile(path.join(process.cwd(), "public", "axus-letterhead.jpg"));
    const pdf = await generateQuotePdf(data, letterhead);

    const num = quote.quoteNumber ?? quote.id;
    const who = quote.customerName ?? quote.customerEmail ?? "a customer";
    const org = quote.customerCompany ? ` (${quote.customerCompany})` : "";

    const custEmail = quote.customerEmail?.trim();
    const ccCustomer = custEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(custEmail);

    const mail = {
      from: MAIL_FROM,
      to: QUOTE_EMAIL_TO,
      cc: ccCustomer ? custEmail : undefined,
      replyTo: quote.customerEmail ?? undefined,
      subject: `Readiness Order quote ${num} — ${who}${org}`,
      text:
        `A customer requested to talk to Axus about their preliminary budgetary quote.\n\n` +
        `Quote #: ${num}\n` +
        `Name: ${quote.customerName ?? "—"}\n` +
        `Email: ${quote.customerEmail ?? "—"}\n` +
        `Organization: ${quote.customerCompany ?? "—"}\n` +
        `Subtotal (approx.): ~$${Math.round(quote.subtotal)}\n\n` +
        `The quote PDF is attached. View it online: https://rorder.axustechnologies.com/quote/${quote.id}\n` +
        (ccCustomer ? `\nA copy of this email has been sent to the customer (${custEmail}).\n` : ""),
      attachments: [
        {
          filename: `Axus-Quote-${num}.pdf`,
          content: Buffer.from(pdf),
          contentType: "application/pdf",
        },
      ],
    };

    // Retry transient SMTP / M365 errors (e.g. "432 mailbox database is offline").
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
      if (RETRY_DELAYS[attempt]) await sleep(RETRY_DELAYS[attempt]);
      try {
        await transport.sendMail(mail);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (lastErr) throw lastErr;

    await prisma.quote.update({
      where: { id },
      data: {
        emailStatus: "sent",
        emailedAt: new Date(),
        emailError: null,
        emailAttempts: { increment: 1 },
      },
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Quote email failed for ${id}:`, msg);
    // Record the failure so the admin sees it and the cron can auto-retry.
    await prisma.quote
      .update({
        where: { id },
        data: {
          emailStatus: "failed",
          emailError: msg.slice(0, 500),
          emailAttempts: { increment: 1 },
        },
      })
      .catch(() => {});
    return {
      ok: false,
      status: 502,
      error: "We couldn't send the email right now. Please try again in a moment.",
    };
  }
}
