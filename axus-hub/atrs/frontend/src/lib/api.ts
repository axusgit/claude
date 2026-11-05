// Thin fetch wrapper for the ATRS API. Auth is handled upstream by the Authentik
// forward-auth proxy (staff/contractor SSO), so requests just need credentials.

export type Role = "admin" | "contractor";

export interface Me {
  email: string;
  name: string;
  role: Role;
}

export type EntryStatus = "draft" | "submitted" | "approved" | "rejected";

export interface TimeEntry {
  id: string;
  worker_email: string;
  worker_name: string | null;
  work_date: string; // YYYY-MM-DD
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  hours: number;
  task: string;
  status: EntryStatus;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
}

export interface StatusTotal {
  status: EntryStatus;
  n: number;
  hours: number;
}
export interface WorkerTotal {
  worker_email: string;
  worker_name: string | null;
  submitted_hours: number;
  approved_hours: number;
  submitted_n: number;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api${path}`, { credentials: "include", ...init, headers: { ...headers, ...init?.headers } });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* non-JSON error */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface EntryInput {
  work_date: string;
  start_time: string;
  end_time: string;
  task: string;
}

export const api = {
  me: () => req<Me>("/me"),

  listEntries: (params: { scope?: "mine" | "all"; status?: string; from?: string; to?: string; worker?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const s = qs.toString();
    return req<{ entries: TimeEntry[]; role: Role }>(`/entries${s ? `?${s}` : ""}`);
  },

  createEntry: (body: EntryInput) => req<{ ok: true; id: string }>("/entries", { method: "POST", body: JSON.stringify(body) }),
  updateEntry: (id: string, body: EntryInput) => req<{ ok: true }>(`/entries/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteEntry: (id: string) => req<{ ok: true }>(`/entries/${id}`, { method: "DELETE" }),

  submit: (ids: string[]) => req<{ ok: true; submitted: number }>("/entries/submit", { method: "POST", body: JSON.stringify({ ids }) }),
  decide: (ids: string[], decision: "approved" | "rejected", note?: string) =>
    req<{ ok: true; decided: number }>("/entries/decide", { method: "POST", body: JSON.stringify({ ids, decision, note }) }),

  summary: (params: { from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const s = qs.toString();
    return req<{ byStatus: StatusTotal[]; byWorker?: WorkerTotal[] }>(`/entries/summary${s ? `?${s}` : ""}`);
  },
};
