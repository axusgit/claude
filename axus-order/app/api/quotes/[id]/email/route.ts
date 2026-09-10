// app/api/quotes/[id]/email/route.ts
// POST: email the quote (PDF attached, on the Axus letterhead) to Axus sales, with
// the customer's email as reply-to. Triggered by "Talk to Axus about this quote".
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { DISCLAIMER_TITLE, DISCLAIMER_TEXT } from "@/lib/disclaimer";
import { generateQuotePdf, type QuotePdfData } from "@/lib/quote-pdf";
import { getTransport, MAIL_FROM, QUOTE_EMAIL_TO } from "@/lib/mailer";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const transport = getTransport();
  if (!transport) {
    return NextResponse.json(
      { error: "Email isn't configured on the server yet." },
      { status: 503 }
    );
  }

  const quote = await prisma.quote.findUnique({
    where: { id },
    include: { lines: { include: { catalogItem: true } } },
  });
  if (!quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });

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
        // Only show a real distributor SKU — skip mock/placeholder/"0" values.
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

    await transport.sendMail({
      from: MAIL_FROM,
      to: QUOTE_EMAIL_TO,
      replyTo: quote.customerEmail ?? undefined,
      subject: `Readiness Order quote ${num} — ${who}${org}`,
      text:
        `A customer requested to talk to Axus about their preliminary budgetary quote.\n\n` +
        `Quote #: ${num}\n` +
        `Name: ${quote.customerName ?? "—"}\n` +
        `Email: ${quote.customerEmail ?? "—"}\n` +
        `Organization: ${quote.customerCompany ?? "—"}\n` +
        `Subtotal (approx.): ~$${Math.round(quote.subtotal)}\n\n` +
        `The quote PDF is attached. View it online: https://rorder.axustechnologies.com/quote/${quote.id}\n`,
      attachments: [
        {
          filename: `Axus-Quote-${num}.pdf`,
          content: Buffer.from(pdf),
          contentType: "application/pdf",
        },
      ],
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Quote email failed:", err);
    return NextResponse.json(
      { error: "We couldn't send the email right now. Please try again in a moment." },
      { status: 502 }
    );
  }
}
