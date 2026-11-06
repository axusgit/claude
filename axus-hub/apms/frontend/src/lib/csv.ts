// CSV parsing + KeePass mapping. Runs entirely in the browser during import: the
// plaintext CSV is read from a <input type=file>, parsed here, mapped to folders +
// item fields, then encrypted before anything is uploaded.
import type { SecretFields } from "./api";

// RFC-4180-ish parser: handles quoted fields, "" escapes, commas and newlines
// inside quotes, and CRLF/LF line endings.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      // Skip fully-blank lines.
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }
  return rows;
}

const SYNONYMS: Record<keyof ColumnMap, string[]> = {
  group: ["group", "grouping", "groups", "folder"],
  title: ["title", "account", "name", "entry"],
  username: ["username", "user name", "login name", "login", "user"],
  password: ["password", "pass"],
  url: ["url", "web site", "website", "link", "uri"],
  notes: ["notes", "comments", "comment", "note"],
  totp: ["totp", "otp", "otpauth"],
};

interface ColumnMap {
  group: number;
  title: number;
  username: number;
  password: number;
  url: number;
  notes: number;
  totp: number;
}

function mapColumns(header: string[]): ColumnMap {
  const norm = header.map((h) => h.trim().toLowerCase());
  const find = (names: string[]) => {
    for (const n of names) {
      const idx = norm.indexOf(n);
      if (idx !== -1) return idx;
    }
    return -1;
  };
  return {
    group: find(SYNONYMS.group),
    title: find(SYNONYMS.title),
    username: find(SYNONYMS.username),
    password: find(SYNONYMS.password),
    url: find(SYNONYMS.url),
    notes: find(SYNONYMS.notes),
    totp: find(SYNONYMS.totp),
  };
}

export interface ParsedEntry {
  // Folder path from the Group column, e.g. ["Servers", "Production"]. Empty =
  // top level. A leading "Root" segment (KeePass default) is dropped.
  path: string[];
  fields: SecretFields;
}

export interface ImportPreview {
  entries: ParsedEntry[];
  folderPaths: string[]; // distinct, "/"-joined, sorted
  columns: ColumnMap;
  skipped: number;
}

function splitGroup(raw: string): string[] {
  const parts = raw
    .split(/[/\\]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length && /^root$/i.test(parts[0])) parts.shift();
  return parts;
}

// Turn parsed CSV rows into import entries. Rows with no title AND no password are
// skipped (blank lines / group-only rows).
export function buildPreview(rows: string[][]): ImportPreview {
  if (rows.length === 0) return { entries: [], folderPaths: [], columns: emptyCols(), skipped: 0 };
  const columns = mapColumns(rows[0]);
  const body = rows.slice(1);
  const get = (r: string[], idx: number) => (idx >= 0 && idx < r.length ? r[idx] : "");
  const entries: ParsedEntry[] = [];
  let skipped = 0;
  for (const r of body) {
    const title = get(r, columns.title).trim();
    const password = get(r, columns.password);
    const username = get(r, columns.username).trim();
    if (!title && !password && !username) {
      skipped++;
      continue;
    }
    const fields: SecretFields = { title: title || username || "(untitled)" };
    if (username) fields.username = username;
    if (password) fields.password = password;
    const url = get(r, columns.url).trim();
    if (url) fields.url = url;
    const notes = get(r, columns.notes);
    if (notes.trim()) fields.notes = notes;
    const totp = get(r, columns.totp).trim();
    if (totp) fields.totp = totp;
    entries.push({ path: splitGroup(get(r, columns.group)), fields });
  }
  const folderSet = new Set<string>();
  for (const e of entries) {
    // Register every ancestor path too, so the folder tree can be created in order.
    for (let i = 1; i <= e.path.length; i++) folderSet.add(e.path.slice(0, i).join("/"));
  }
  return {
    entries,
    folderPaths: [...folderSet].sort(),
    columns,
    skipped,
  };
}

function emptyCols(): ColumnMap {
  return { group: -1, title: -1, username: -1, password: -1, url: -1, notes: -1, totp: -1 };
}
