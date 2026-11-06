// Thin fetch wrapper around the APMS backend. All payloads are already ciphertext
// (or non-secret metadata) — the backend never sees plaintext.

export type ApmsRole = "admin" | "user";

export interface Me {
  email: string;
  name: string;
  role: ApmsRole;
  groups: string[];
  vaultInitialized: boolean;
}

export interface VaultMaterial {
  kdf: string;
  kdf_salt: string;
  wrapped_vk: string;
  verifier: string;
}

export interface InitVaultBody {
  kdf: string;
  kdf_salt: string;
  wrapped_vk: string;
  verifier: string;
  recovery_pubkey: string;
  recovery_wrapped_vk: string;
}

export interface FolderRow {
  id: string;
  parent_id: string | null;
  name_enc: string;
  wrapped_fk: string;
  sort: number;
  can_write: boolean;
}

export interface ItemRow {
  id: string;
  folder_id: string;
  data_enc: string;
  updated_at: string;
  updated_by: string;
}

export interface AccessGrant {
  principal: string; // 'group:<name>' | 'user:<email>'
  can_write: boolean;
}

export interface AuditEvent {
  ts: string;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new Error((data && (data.error as string)) || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  me: () => req<Me>("GET", "/api/me"),

  getVault: () => req<VaultMaterial>("GET", "/api/vault"),
  initVault: (b: InitVaultBody) => req<{ ok: true }>("POST", "/api/vault/init", b),
  rekeyVault: (b: { kdf: string; kdf_salt: string; wrapped_vk: string; reason?: string }) =>
    req<{ ok: true }>("POST", "/api/vault/rekey", b),
  recoveryMaterial: () =>
    req<{ recovery_wrapped_vk: string; recovery_pubkey: string }>("GET", "/api/vault/recovery"),

  listFolders: () => req<{ folders: FolderRow[]; isAdmin: boolean }>("GET", "/api/folders"),
  createFolder: (b: { parent_id: string | null; name_enc: string; wrapped_fk: string; sort?: number }) =>
    req<{ id: string }>("POST", "/api/folders", b),
  updateFolder: (id: string, b: { name_enc?: string; sort?: number; parent_id?: string | null }) =>
    req<{ ok: true }>("PATCH", `/api/folders/${id}`, b),
  deleteFolder: (id: string) => req<{ ok: true }>("DELETE", `/api/folders/${id}`),
  getFolderAccess: (id: string) => req<{ grants: AccessGrant[] }>("GET", `/api/folders/${id}/access`),
  setFolderAccess: (id: string, grants: AccessGrant[]) =>
    req<{ ok: true }>("PUT", `/api/folders/${id}/access`, { grants }),

  listItems: () => req<{ items: ItemRow[] }>("GET", "/api/items"),
  createItem: (b: { folder_id: string; data_enc: string }) => req<{ id: string }>("POST", "/api/items", b),
  updateItem: (id: string, b: { data_enc?: string; folder_id?: string }) =>
    req<{ ok: true }>("PATCH", `/api/items/${id}`, b),
  deleteItem: (id: string) => req<{ ok: true }>("DELETE", `/api/items/${id}`),
  importItems: (items: { folder_id: string; data_enc: string }[]) =>
    req<{ ok: true; imported: number }>("POST", "/api/items/import", { items }),

  logEvent: (action: string, target?: string) =>
    req<{ ok: true }>("POST", "/api/audit", { action, target }).catch(() => undefined),
  listAudit: (limit = 200) => req<{ events: AuditEvent[] }>("GET", `/api/audit?limit=${limit}`),
};

// --- plaintext item shape (lives only in the browser, encrypted before upload)
export interface SecretField {
  label: string;
  value: string;
  hidden?: boolean;
}
export interface SecretFields {
  title: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  totp?: string;
  custom?: SecretField[];
}
