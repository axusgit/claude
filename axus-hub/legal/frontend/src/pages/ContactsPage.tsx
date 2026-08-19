import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Upload, Users } from "lucide-react";
import { contactsApi, type Contact } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";

// Minimal CSV parser (handles quoted fields, embedded commas/newlines).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      /* ignore */
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Map a QuickBooks (or generic) customer export into contacts. Handles the
// title rows QuickBooks puts above the header, multi-email cells, and
// sub-customers (Parent:Job) — deduping by email.
function parseContactsCsv(text: string): { name: string; email: string; company?: string }[] {
  const all = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  const hi = all.findIndex((r) => r.some((c) => /^e-?mail$/i.test(c.trim())));
  if (hi < 0) return [];
  const header = all[hi].map((h) => h.trim().toLowerCase());
  const findIdx = (...names: (string | RegExp)[]) => {
    for (const n of names) {
      const i = header.findIndex((h) => (n instanceof RegExp ? n.test(h) : h === n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const emailIdx = findIdx("email", /e-?mail/);
  if (emailIdx < 0) return [];
  const custIdx = findIdx("customer full name", "customer", "display name");
  const personIdx = findIdx("full name", "first name", "first");
  const lastIdx = findIdx("last name", "last");
  const companyIdx = findIdx("company", "company name");

  const seen = new Set<string>();
  const out: { name: string; email: string; company?: string }[] = [];
  for (let i = hi + 1; i < all.length; i++) {
    const r = all[i];
    const raw = (r[emailIdx] ?? "").trim();
    if (!raw) continue;
    const email = raw.split(",")[0].trim(); // first email if several
    if (!email || seen.has(email.toLowerCase())) continue;
    const cust = custIdx >= 0 ? (r[custIdx] ?? "").trim() : "";
    const parent = cust.split(":")[0].trim(); // collapse Parent:Job sub-customers
    let person = personIdx >= 0 ? (r[personIdx] ?? "").replace(/\s+/g, " ").trim() : "";
    if (!person && lastIdx >= 0) {
      person = `${r[personIdx] ?? ""} ${r[lastIdx] ?? ""}`.replace(/\s+/g, " ").trim();
    }
    const company = companyIdx >= 0 ? (r[companyIdx] ?? "").trim() : parent;
    seen.add(email.toLowerCase());
    out.push({ name: person || parent || email, email, company: company || undefined });
  }
  return out;
}

export function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      setContacts(await contactsApi.list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function add() {
    if (!name.trim() || !email.trim()) return;
    setAdding(true);
    try {
      await contactsApi.add({ name: name.trim(), email: email.trim(), company: company.trim() || undefined });
      setName("");
      setEmail("");
      setCompany("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  }
  async function remove(id: string) {
    if (!window.confirm("Delete this contact?")) return;
    await contactsApi.remove(id);
    await load();
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    setImportMsg(null);
    try {
      const rows = parseContactsCsv(await file.text());
      if (rows.length === 0) {
        setError("No importable rows found — make sure the file has an Email column.");
        return;
      }
      const res = await contactsApi.import(rows);
      setImportMsg(
        `Imported ${res.imported} contact${res.imported === 1 ? "" : "s"}` +
          (res.skipped ? `, skipped ${res.skipped} without a valid email.` : "."),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Contacts</h1>
          <p className="text-sm text-muted">
            Save people you send documents to, so you can pick them instead of retyping.
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onImportFile}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
            <Upload className="h-4 w-4" /> {importing ? "Importing…" : "Import CSV"}
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Full name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@company.com"
              onKeyDown={(e) => e.key === "Enter" && void add()}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Company <span className="text-muted">(optional)</span>
            </label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" />
          </div>
          <Button onClick={() => void add()} disabled={adding || !name.trim() || !email.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </Card>

      {importMsg && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{importMsg}</div>
      )}
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <Card>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted">Loading…</div>
        ) : contacts.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="mx-auto h-8 w-8 text-muted" />
            <p className="mt-3 text-sm font-medium">No contacts yet</p>
            <p className="text-sm text-muted">Add people above to build your contact list.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-muted">{c.email}</td>
                  <td className="px-4 py-3 text-muted">{c.company ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => void remove(c.id)}
                      className="text-muted hover:text-red-600"
                      title="Delete contact"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
