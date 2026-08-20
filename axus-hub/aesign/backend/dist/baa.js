import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
// Today's date in Eastern Time, formatted like "August 20, 2026".
export function etTodayLong() {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        month: "long",
        day: "numeric",
        year: "numeric",
    }).format(new Date());
}
// Fill the BAA page-1 blanks: Effective Date (today) and Covered Entity (company).
// Anchor points were derived from the template's page-1 text geometry (612x792,
// baselines y=577 / y=564; blanks start x≈391 / x≈208).
export async function stampBaaPdf(bytes, opts) {
    const pdf = await PDFDocument.load(bytes);
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.getPages()[0];
    if (!page)
        return pdf.save();
    const ink = rgb(0.09, 0.11, 0.15);
    const size = 9.5;
    if (opts.dateLong) {
        page.drawText(opts.dateLong, { x: 393, y: 579, size, font: helv, color: ink });
    }
    if (opts.company) {
        // Keep the name inside the blank (blank runs ~x208 → ~x395).
        let name = opts.company;
        while (name.length > 1 && helv.widthOfTextAtSize(name, size) > 185)
            name = name.slice(0, -1);
        page.drawText(name, { x: 210, y: 566, size, font: helv, color: ink });
    }
    return pdf.save();
}
//# sourceMappingURL=baa.js.map