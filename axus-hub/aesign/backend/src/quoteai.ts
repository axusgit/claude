// AI quote extraction — turns a sales person's raw inputs (forwarded emails,
// notes, vendor quotes, spec sheets, screenshots) into a structured draft quote
// that pre-fills the QuoteBuilder. The human always reviews/edits before saving.
//
// Uses OpenAI's Responses API so PDFs and images are read NATIVELY (no OCR/parse
// libraries); Word/other office docs are converted to PDF via Gotenberg first;
// plain text / email files are passed inline. Output is forced to a strict JSON
// schema matching QuoteData (minus the system-assigned quote number/date).
import { config } from "./config.js";

// Extracted shape — mirrors QuoteData, but every field optional (the model fills
// what the documents support; the builder supplies number/date/defaults).
export interface ExtractedQuote {
  customer: { company: string; contact?: string; address?: string; phone?: string };
  salesperson?: string;
  job?: string;
  shipping_method?: string;
  delivery_date?: string;
  payment_terms?: string;
  due_date?: string;
  valid_until?: string;
  items: { qty: number; item: string; description: string; unit_price: number; discount: number }[];
  tax?: string;
  notes?: string;
}

export interface AnalyzeInput {
  filename: string;
  buf: Buffer;
  mimetype: string;
}

const MAX_FILES = 5;
// Office formats Gotenberg/LibreOffice converts to PDF so the model can read them.
const OFFICE_EXT = new Set(["doc", "docx", "rtf", "odt", "pptx", "ppt", "odp", "xlsx", "xls", "ods", "csv"]);
const TEXT_EXT = new Set(["txt", "text", "md", "markdown", "eml", "mbox", "html", "htm", "json", "log"]);
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function extOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

// Convert a Word/office document to PDF bytes via Gotenberg (LibreOffice). Returns
// null on failure (the caller records a warning and skips the file).
async function officeToPdf(buf: Buffer, filename: string): Promise<Buffer | null> {
  try {
    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(buf)]), filename);
    const res = await fetch(`${config.gotenbergUrl}/forms/libreoffice/convert`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// Strict JSON schema the model must return (OpenAI Structured Outputs). Optional
// fields are nullable + listed in `required` as strict mode demands; we coerce
// nulls away afterwards.
const QUOTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "customer",
    "items",
    "salesperson",
    "job",
    "shipping_method",
    "delivery_date",
    "payment_terms",
    "due_date",
    "valid_until",
    "tax",
    "notes",
  ],
  properties: {
    customer: {
      type: "object",
      additionalProperties: false,
      required: ["company", "contact", "address", "phone"],
      properties: {
        company: { type: "string", description: "Customer/company the quote is FOR (the buyer), not the vendor/supplier." },
        contact: { type: ["string", "null"], description: "Primary contact person's full name." },
        address: { type: ["string", "null"], description: "Customer billing/shipping address, one line." },
        phone: { type: ["string", "null"] },
      },
    },
    items: {
      type: "array",
      description: "Line items to quote. One row per distinct product/service.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["qty", "item", "description", "unit_price", "discount"],
        properties: {
          qty: { type: "number", description: "Quantity; default 1 if unstated." },
          item: { type: ["string", "null"], description: "SKU / model / part / item number if present (short)." },
          description: {
            type: "string",
            description:
              "The FULL description of the line, kept verbatim. For a configured product (e.g. a server build, a bundle, a system with many components) KEEP EVERY configuration / spec / component line — put the product name on the first line and each spec/component on its own line, separated by newlines (\\n). Never summarize, shorten, or drop detail lines.",
          },
          unit_price: { type: "number", description: "Price PER UNIT in USD (number only, no $). 0 if unknown." },
          discount: { type: "number", description: "Per-unit discount in USD; 0 if none." },
        },
      },
    },
    salesperson: { type: ["string", "null"], description: "Axus salesperson initials/name if stated; else null." },
    job: { type: ["string", "null"], description: "Job / project name if mentioned." },
    shipping_method: { type: ["string", "null"] },
    delivery_date: { type: ["string", "null"] },
    payment_terms: { type: ["string", "null"], description: 'e.g. "Net30".' },
    due_date: { type: ["string", "null"] },
    valid_until: { type: ["string", "null"], description: "Quote validity date if stated." },
    tax: { type: ["string", "null"], description: '"EXEMPT" or a dollar amount; null if unknown.' },
    notes: { type: ["string", "null"], description: "Short note worth surfacing on the quote (<=500 chars)." },
  },
} as const;

const SYSTEM_PROMPT = `You are a sales-operations assistant for Axus Technologies, an IT managed-services provider. You read raw sales inputs (forwarded customer emails, meeting notes, vendor/supplier quotes, spec sheets, screenshots) and extract a structured DRAFT quote.

Rules:
- Axus is the SELLER. The "customer" is the BUYER being quoted — never put Axus or a parts vendor/distributor/OEM (e.g. TD SYNNEX, Ingram, Dell) as the customer. If no buyer is named in the documents, leave customer fields null/empty — do NOT guess.
- Extract every distinct priced product/service as its own line item.
- PRESERVE DESCRIPTIONS IN FULL. Do not summarize or trim. A configured product (e.g. a Dell PowerEdge server build, a bundle, a system) is usually ONE line item with ONE price: put the product name on the first line of "description" and then EVERY configuration / component / spec line beneath it, each on its own line separated by newlines (\\n). It is wrong to collapse a 40-line server configuration down to its model name — keep all the lines.
- A single sell/total price for a configured product is that product's price. With qty 1, unit_price = that price. If a price is clearly a line total for quantity N, divide by N for the per-unit price.
- unit_price and discount are plain numbers (no "$", no commas).
- Never invent prices, quantities, SKUs, or contact details. If something is not supported by the documents, use null (or 0 for an unknown numeric price). It is correct to return an empty items array if no priced items are present.
- Capture a stated estimated delivery / ship date in delivery_date, and a stated quote-expiration/validity in valid_until, when present.
- Do not add tax unless the documents state one; leave tax null (the quote defaults to EXEMPT).`;

interface OaiContentPart {
  type: "input_text" | "input_file" | "input_image";
  text?: string;
  filename?: string;
  file_data?: string;
  image_url?: string;
}

// Build the user content parts from the uploaded files + pasted text, converting
// office docs to PDF. Returns the parts plus any per-file warnings.
async function buildContent(
  input: { files: AnalyzeInput[]; text?: string },
): Promise<{ parts: OaiContentPart[]; warnings: string[] }> {
  const parts: OaiContentPart[] = [];
  const warnings: string[] = [];

  const pasted = (input.text ?? "").trim();
  if (pasted) {
    parts.push({ type: "input_text", text: `Pasted notes / email text from the salesperson:\n\n${pasted.slice(0, 60000)}` });
  }

  for (const f of input.files.slice(0, MAX_FILES)) {
    const ext = extOf(f.filename);
    const mime = (f.mimetype || "").toLowerCase();

    // Images → native vision.
    if (mime.startsWith("image/") || IMAGE_MIME[ext]) {
      const imgMime = mime.startsWith("image/") ? mime : IMAGE_MIME[ext];
      parts.push({ type: "input_image", image_url: `data:${imgMime};base64,${f.buf.toString("base64")}` });
      continue;
    }

    // PDFs → native file input.
    if (ext === "pdf" || mime === "application/pdf") {
      parts.push({
        type: "input_file",
        filename: f.filename,
        file_data: `data:application/pdf;base64,${f.buf.toString("base64")}`,
      });
      continue;
    }

    // Plain text / email → inline text (the model reads raw MIME fine).
    if (TEXT_EXT.has(ext) || mime.startsWith("text/")) {
      const txt = f.buf.toString("utf8").slice(0, 60000);
      parts.push({ type: "input_text", text: `Document "${f.filename}":\n\n${txt}` });
      continue;
    }

    // Office docs → Gotenberg → PDF → native file input.
    if (OFFICE_EXT.has(ext)) {
      const pdf = await officeToPdf(f.buf, f.filename);
      if (pdf) {
        parts.push({
          type: "input_file",
          filename: f.filename.replace(/\.[^.]+$/, ".pdf"),
          file_data: `data:application/pdf;base64,${pdf.toString("base64")}`,
        });
      } else {
        warnings.push(`Could not convert "${f.filename}" — skipped.`);
      }
      continue;
    }

    // Outlook .msg and anything else we can't read reliably.
    if (ext === "msg") {
      warnings.push(`"${f.filename}" is an Outlook .msg — export it as .eml or paste the email text instead (skipped).`);
    } else {
      warnings.push(`Unsupported file "${f.filename}" (${ext || mime || "unknown type"}) — skipped.`);
    }
  }

  return { parts, warnings };
}

// Coerce the model's nullable JSON into a clean ExtractedQuote.
function clean(raw: any): ExtractedQuote {
  const s = (v: unknown): string | undefined => {
    const t = typeof v === "string" ? v.trim() : "";
    return t ? t : undefined;
  };
  const n = (v: unknown): number => {
    const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(x) ? x : 0;
  };
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return {
    customer: {
      company: s(raw?.customer?.company) ?? "",
      contact: s(raw?.customer?.contact),
      address: s(raw?.customer?.address),
      phone: s(raw?.customer?.phone),
    },
    salesperson: s(raw?.salesperson),
    job: s(raw?.job),
    shipping_method: s(raw?.shipping_method),
    delivery_date: s(raw?.delivery_date),
    payment_terms: s(raw?.payment_terms),
    due_date: s(raw?.due_date),
    valid_until: s(raw?.valid_until),
    tax: s(raw?.tax),
    notes: s(raw?.notes)?.slice(0, 500),
    items: items.map((it: any) => ({
      qty: n(it?.qty) || 1,
      item: s(it?.item) ?? "",
      description: s(it?.description) ?? "",
      unit_price: n(it?.unit_price),
      discount: n(it?.discount),
    })),
  };
}

// Pull the model's JSON text out of a Responses API payload (defensive across
// minor shape differences).
function extractJsonText(data: any): string | null {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text;
  const out = Array.isArray(data?.output) ? data.output : [];
  for (const msg of out) {
    const content = Array.isArray(msg?.content) ? msg.content : [];
    for (const c of content) {
      if ((c?.type === "output_text" || c?.type === "text") && typeof c?.text === "string") return c.text;
    }
  }
  return null;
}

/**
 * Analyze the uploaded documents + pasted text and return a draft quote plus any
 * warnings (unreadable files, etc). Throws on a hard failure (no key, API error,
 * unparseable output) so the route can surface a clear message.
 */
export async function analyzeDocumentsToQuote(
  input: { files: AnalyzeInput[]; text?: string },
): Promise<{ quote: ExtractedQuote; warnings: string[] }> {
  if (!config.openaiApiKey) {
    const e = new Error("AI quote drafting is not configured (OPENAI_API_KEY unset).");
    (e as any).status = 503;
    throw e;
  }
  const { parts, warnings } = await buildContent(input);
  if (!parts.some((p) => p.type !== "input_text") && !(input.text ?? "").trim()) {
    const e = new Error("Add at least one readable document or paste some text to analyze.");
    (e as any).status = 400;
    throw e;
  }

  const payload = {
    model: config.quoteAiModel,
    input: [
      { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Extract a draft quote for Axus to send to its customer from the following materials:" },
          ...parts,
        ],
      },
    ],
    text: { format: { type: "json_schema", name: "quote_extraction", strict: true, schema: QUOTE_SCHEMA } },
    max_output_tokens: 4000,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let data: any;
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `OpenAI error (${res.status})`;
      const e = new Error(msg);
      (e as any).status = res.status === 429 ? 429 : 502;
      throw e;
    }
  } catch (err) {
    if ((err as any)?.name === "AbortError") {
      const e = new Error("The AI took too long to analyze the documents. Try fewer or smaller files.");
      (e as any).status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (data?.status === "incomplete") {
    warnings.push("The documents were large; the draft may be partial — review carefully.");
  }
  const jsonText = extractJsonText(data);
  if (!jsonText) throw Object.assign(new Error("The AI returned no usable result. Try again or draft manually."), { status: 502 });
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw Object.assign(new Error("Could not parse the AI result. Try again or draft manually."), { status: 502 });
  }
  return { quote: clean(parsed), warnings };
}
