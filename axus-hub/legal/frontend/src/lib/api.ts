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
}

export interface Recipient {
  id?: string;
  name: string;
  email: string;
  role: string; // signer | viewer | approver
  sign_order: number;
  status?: string;
}

export type FieldType = "signature" | "name" | "initials" | "date" | "text" | "checkbox";

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

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listEnvelopes: () => req<{ envelopes: Envelope[] }>("/envelopes").then((r) => r.envelopes),
  createEnvelope: (title: string) =>
    req<{ envelope: Envelope }>("/envelopes", {
      method: "POST",
      body: JSON.stringify({ title }),
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
  updateEnvelope: (id: string, patch: { sequential?: boolean }) =>
    req<{ envelope: Envelope }>(`/envelopes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then((r) => r.envelope),
  sendEnvelope: (id: string) =>
    req<{ ok: boolean; results: { email: string; sent: boolean }[] }>(`/envelopes/${id}/send`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  documentUrl: (id: string) => `/api/envelopes/${id}/document`,
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
