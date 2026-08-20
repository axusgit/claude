export interface Envelope {
  id: string;
  title: string;
  status: string;
  created_by?: string;
  created_at: string;
  sent_at?: string | null;
  completed_at?: string | null;
  source_file?: string | null;
  pdf_file?: string | null;
  sequential?: boolean;
  doc_type?: string | null;
  company?: string | null;
  reminder_interval?: string | null;
  reminder_time?: string | null;
  reminder_dow?: number | null;
  reminder_dom?: number | null;
  recipients?: { name: string; status: string }[];
  quote_data?: QuoteData | null;
}

export interface Recipient {
  id?: string;
  name: string;
  email: string;
  role: string; // signer | viewer | approver
  sign_order: number;
  status?: string;
}

export type FieldType = "signature" | "name" | "title" | "initials" | "date" | "text";

export interface Field {
  id?: string;
  recipient_id?: string | null;
  type: FieldType;
  page: number;
  x: number; // normalized 0..1 (top-left)
  y: number;
  w: number;
  h: number;
  value?: string | null;
  required?: boolean;
}

export interface EnvelopeDetail {
  envelope: Envelope;
  recipients: Recipient[];
  fields: Field[];
  events: { actor: string; type: string; detail: string | null; ip?: string | null; at: string }[];
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  // Only set a JSON content-type when there's actually a body — otherwise Fastify
  // rejects the empty body ("Body cannot be empty when content-type is json").
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> | undefined) };
  if (opts.body != null) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api${path}`, { ...opts, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listEnvelopes: () => req<{ envelopes: Envelope[] }>("/envelopes").then((r) => r.envelopes),
  createEnvelope: (data: {
    title: string;
    doc_type?: string;
    company?: string;
    reminder_interval?: string;
  }) =>
    req<{ envelope: Envelope }>("/envelopes", {
      method: "POST",
      body: JSON.stringify(data),
    }).then((r) => r.envelope),
  getEnvelope: (id: string) => req<EnvelopeDetail>(`/envelopes/${id}`),
  uploadDocument: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`/api/envelopes/${id}/document`, { method: "POST", body: fd }).then(
      async (res) => {
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        return res.json();
      },
    );
  },
  saveRecipients: (id: string, recipients: Recipient[]) =>
    req<{ recipients: Recipient[] }>(`/envelopes/${id}/recipients`, {
      method: "PUT",
      body: JSON.stringify({ recipients }),
    }).then((r) => r.recipients),
  saveFields: (id: string, fields: Field[]) =>
    req<{ ok: boolean }>(`/envelopes/${id}/fields`, {
      method: "PUT",
      body: JSON.stringify({ fields }),
    }),
  updateEnvelope: (
    id: string,
    patch: {
      sequential?: boolean;
      doc_type?: string;
      company?: string;
      title?: string;
      reminder_interval?: string;
      reminder_time?: string;
      reminder_dow?: number;
      reminder_dom?: number;
    },
  ) =>
    req<{ envelope: Envelope }>(`/envelopes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then((r) => r.envelope),
  applyTemplate: (id: string) =>
    req<{ ok: boolean; applied: boolean }>(`/envelopes/${id}/apply-template`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  sendEnvelope: (id: string) =>
    req<{ ok: boolean; results: { email: string; sent: boolean }[] }>(`/envelopes/${id}/send`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  deleteEnvelope: (id: string) =>
    req<{ ok: boolean }>(`/envelopes/${id}`, { method: "DELETE" }),
  cancelEnvelope: (id: string) =>
    req<{ ok: boolean }>(`/envelopes/${id}/cancel`, { method: "POST", body: JSON.stringify({}) }),
  documentUrl: (id: string) => `/api/envelopes/${id}/document`,
};

// --- Contacts (reusable recipient list, shared across staff) ---
export interface Contact {
  id: string;
  name: string;
  email: string;
  company?: string | null;
}

export const contactsApi = {
  list: () => req<{ contacts: Contact[] }>("/contacts").then((r) => r.contacts),
  add: (c: { name: string; email: string; company?: string }) =>
    req<{ contact: Contact }>("/contacts", { method: "POST", body: JSON.stringify(c) }).then(
      (r) => r.contact,
    ),
  update: (id: string, patch: { name?: string; email?: string; company?: string }) =>
    req<{ contact: Contact }>(`/contacts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then((r) => r.contact),
  remove: (id: string) => req<{ ok: boolean }>(`/contacts/${id}`, { method: "DELETE" }),
  import: (contacts: { name: string; email: string; company?: string }[]) =>
    req<{ imported: number; skipped: number }>("/contacts/import", {
      method: "POST",
      body: JSON.stringify({ contacts }),
    }),
};

// --- Companies (associated with each document) ---
export interface Company {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
}

// --- Quotes (generated documents) ---
export interface QuoteItem {
  qty: number;
  item: string;
  description: string;
  unit_price: number;
  discount: number;
}
export interface QuoteData {
  quote_number: string;
  quote_date: string;
  valid_until?: string;
  customer: { company: string; contact?: string; address?: string; phone?: string };
  salesperson?: string;
  job?: string;
  shipping_method?: string;
  delivery_date?: string;
  payment_terms?: string;
  due_date?: string;
  items: QuoteItem[];
  tax?: string;
}

export const quotesApi = {
  create: (title: string, quote: QuoteData) =>
    req<{ envelope: Envelope }>("/quotes", {
      method: "POST",
      body: JSON.stringify({ title, quote }),
    }).then((r) => r.envelope),
  update: (id: string, title: string, quote: QuoteData) =>
    req<{ envelope: Envelope }>(`/quotes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title, quote }),
    }).then((r) => r.envelope),
};

export const companiesApi = {
  list: () => req<{ companies: Company[] }>("/companies").then((r) => r.companies),
  add: (data: { name: string; address?: string; phone?: string }) =>
    req<{ company: Company }>("/companies", { method: "POST", body: JSON.stringify(data) }).then(
      (r) => r.company,
    ),
  update: (id: string, patch: { name?: string; address?: string; phone?: string }) =>
    req<{ company: Company }>(`/companies/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then((r) => r.company),
  remove: (id: string) => req<{ ok: boolean }>(`/companies/${id}`, { method: "DELETE" }),
};

// --- Public signer API (token-based, no auth) ---
export interface SignView {
  envelope: { id: string; title: string; status: string };
  recipient: { name: string; email: string; status: string };
  fields: Field[];
  alreadySigned: boolean;
}

export const signApi = {
  get: (token: string) =>
    fetch(`/api/sign/${token}`).then(async (r) => {
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || `HTTP ${r.status}`);
      return r.json() as Promise<SignView>;
    }),
  documentUrl: (token: string) => `/api/sign/${token}/document`,
  complete: (token: string, consent: boolean, fields: { id: string; value: string }[]) =>
    fetch(`/api/sign/${token}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent, fields }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || `HTTP ${r.status}`);
      return r.json() as Promise<{ ok: boolean; completed: boolean }>;
    }),
};
