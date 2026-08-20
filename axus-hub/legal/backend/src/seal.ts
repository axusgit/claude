import { PDFDocument, StandardFonts, rgb, type Color } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export interface SealField {
  type: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: string | null;
}
export interface SealRecipient {
  name: string;
  email: string;
  signed_at: string | null;
  ip: string | null;
}

// Flatten field values/signatures onto the source PDF and append a certificate
// of completion. Returns the sealed bytes + their SHA-256 (integrity proof).
export async function sealPdf(
  sourcePath: string,
  fields: SealField[],
  recipients: SealRecipient[],
  meta: { title: string; envelopeId: string },
  includeCert = true,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  const src = await readFile(sourcePath);
  const pdf = await PDFDocument.load(src);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();

  for (const f of fields) {
    if (f.value == null || f.value === "") continue;
    const page = pages[f.page - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const x = f.x * pw;
    const boxH = f.h * ph;
    const boxW = f.w * pw;
    const yBottom = ph - f.y * ph - boxH;

    if (f.type === "signature" || f.type === "initials") {
      if (f.value.startsWith("data:image")) {
        const b64 = f.value.split(",")[1] ?? "";
        const img = await pdf.embedPng(Buffer.from(b64, "base64"));
        const scale = Math.min(boxW / img.width, boxH / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x, y: yBottom + (boxH - h) / 2, width: w, height: h });
      }
    } else if (f.type === "checkbox") {
      if (f.value === "true" || f.value === "1") {
        page.drawText("X", {
          x: x + 1,
          y: yBottom + 1,
          size: Math.min(boxH, 12),
          font: bold,
          color: rgb(0.1, 0.1, 0.1),
        });
      }
    } else {
      const size = Math.min(boxH * 0.8, 11);
      page.drawText(f.value, {
        x: x + 1,
        y: yBottom + (boxH - size) / 2 + 1,
        size,
        font: helv,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
  }

  // --- Certificate of completion (only on the final, fully-signed copy) ---
  if (includeCert) {
  const cert = pdf.addPage([612, 792]);
  let y = 736;
  const line = (t: string, o?: { bold?: boolean; size?: number; color?: Color }) => {
    const size = o?.size ?? 10;
    cert.drawText(t, { x: 54, y, size, font: o?.bold ? bold : helv, color: o?.color ?? rgb(0.25, 0.25, 0.25) });
    y -= size + 6;
  };
  cert.drawRectangle({ x: 0, y: 788, width: 612, height: 4, color: rgb(0.92, 0.35, 0.05) });
  line("Axus Legal — Certificate of Completion", { bold: true, size: 16, color: rgb(0.07, 0.09, 0.15) });
  y -= 6;
  line(`Document: ${meta.title}`, { bold: true, size: 11 });
  line(`Envelope ID: ${meta.envelopeId}`);
  y -= 8;
  line("Signers", { bold: true, size: 12, color: rgb(0.07, 0.09, 0.15) });
  for (const r of recipients) {
    line(`• ${r.name} <${r.email}>`, { bold: true });
    line(`    Signed: ${r.signed_at ?? "—"}     IP: ${r.ip ?? "—"}`);
    y -= 2;
  }
  y -= 6;
  line("Executed electronically under the U.S. ESIGN Act and UETA. Each signer consented to", {
    size: 9,
    color: rgb(0.45, 0.45, 0.45),
  });
  line("sign electronically; identity was attributed via a unique emailed link, with timestamp and", {
    size: 9,
    color: rgb(0.45, 0.45, 0.45),
  });
  line("IP address recorded in the audit trail.", { size: 9, color: rgb(0.45, 0.45, 0.45) });
  }

  const bytes = await pdf.save();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes, sha256 };
}
