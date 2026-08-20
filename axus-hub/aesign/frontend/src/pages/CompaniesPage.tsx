import { useEffect, useState } from "react";
import { Building2, Check, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { companiesApi, contactsApi, type Company, type Contact } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";

export function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "with" | "without">("all");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [addr, setAddr] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddr, setEditAddr] = useState("");

  async function load() {
    setLoading(true);
    try {
      setCompanies(await companiesApi.list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    contactsApi.list().then(setContacts).catch(() => {});
  }, []);

  const contactsByCompany = new Map<string, string[]>();
  for (const ct of contacts) {
    const key = (ct.company ?? "").trim().toLowerCase();
    if (!key) continue;
    const arr = contactsByCompany.get(key) ?? [];
    arr.push(ct.name);
    contactsByCompany.set(key, arr);
  }
  const namesFor = (c: Company) => contactsByCompany.get(c.name.trim().toLowerCase()) ?? [];
  const q = query.trim().toLowerCase();
  const filtered = companies.filter((c) => {
    const matchesQ =
      !q ||
      [c.name, c.phone, c.address, namesFor(c).join(" ")].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      );
    const has = namesFor(c).length > 0;
    const matchesF = filter === "all" || (filter === "with" ? has : !has);
    return matchesQ && matchesF;
  });

  async function add() {
    if (!name.trim()) return;
    setAdding(true);
    try {
      const c = await companiesApi.add({ name: name.trim(), phone: phone.trim(), address: addr.trim() });
      setCompanies((cs) =>
        [...cs.filter((x) => x.id !== c.id), c].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setName("");
      setPhone("");
      setAddr("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  }
  function startEdit(c: Company) {
    setEditId(c.id);
    setEditName(c.name);
    setEditPhone(c.phone ?? "");
    setEditAddr(c.address ?? "");
  }
  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    try {
      const updated = await companiesApi.update(id, {
        name: editName.trim(),
        phone: editPhone.trim(),
        address: editAddr.trim(),
      });
      setCompanies((cs) => cs.map((c) => (c.id === id ? updated : c)));
      setEditId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    }
  }
  async function remove(id: string) {
    if (!window.confirm("Delete this company?")) return;
    try {
      await companiesApi.remove(id);
      setCompanies((cs) => cs.filter((c) => c.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Companies</h1>
        <p className="text-sm text-muted">Companies your documents and quotes are associated with.</p>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Company name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="AGAPE NETWORK" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Phone</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="305-235-2616" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Address</label>
            <Input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Street, City, ST ZIP" />
          </div>
          <Button onClick={() => void add()} disabled={adding || !name.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </Card>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, or address…"
            className="pl-9"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as "all" | "with" | "without")}
          className="rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
        >
          <option value="all">All companies</option>
          <option value="with">With contacts</option>
          <option value="without">Without contacts</option>
        </select>
      </div>

      <Card>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted">Loading…</div>
        ) : companies.length === 0 ? (
          <div className="p-12 text-center">
            <Building2 className="mx-auto h-8 w-8 text-muted" />
            <p className="mt-3 text-sm font-medium">No companies yet</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted">
            No companies match your search.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">
                  Company ({filtered.length === companies.length ? companies.length : `${filtered.length} of ${companies.length}`})
                </th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Contacts</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) =>
                editId === c.id ? (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={editAddr} onChange={(e) => setEditAddr(e.target.value)} placeholder="Address" />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Phone" />
                    </td>
                    <td className="px-4 py-2 text-muted">{namesFor(c).join(", ") || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => void saveEdit(c.id)} className="text-brand hover:opacity-80" title="Save">
                          <Check className="h-4 w-4" />
                        </button>
                        <button onClick={() => setEditId(null)} className="text-muted hover:text-ink" title="Cancel">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} className="group border-b border-line last:border-0">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-muted">{c.address || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{c.phone || "—"}</td>
                    <td className="px-4 py-3 text-muted">{namesFor(c).join(", ") || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => startEdit(c)} className="text-muted hover:text-brand" title="Edit">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => void remove(c.id)} className="text-muted hover:text-red-600" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
