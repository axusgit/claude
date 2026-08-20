import { useEffect, useState } from "react";
import { Building2, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { companiesApi, type Company } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";

export function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

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
  }, []);

  async function add() {
    if (!name.trim()) return;
    setAdding(true);
    try {
      const added = await companiesApi.add(name.trim());
      setCompanies((cs) =>
        [...cs.filter((c) => c.id !== added.id), added].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  }
  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    try {
      const updated = await companiesApi.update(id, editName.trim());
      setCompanies((cs) => cs.map((c) => (c.id === id ? updated : c))); // in place, keep position
      setEditId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rename");
    }
  }
  async function remove(id: string) {
    if (!window.confirm("Delete this company?")) return;
    try {
      await companiesApi.remove(id);
      setCompanies((cs) => cs.filter((c) => c.id !== id)); // stay in place, no reload
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Companies</h1>
        <p className="text-sm text-muted">Companies your documents are associated with.</p>
      </div>

      <Card className="p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <label className="text-sm font-medium">Company name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. AGAPE NETWORK"
              onKeyDown={(e) => e.key === "Enter" && void add()}
            />
          </div>
          <Button onClick={() => void add()} disabled={adding || !name.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </Card>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <Card>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted">Loading…</div>
        ) : companies.length === 0 ? (
          <div className="p-12 text-center">
            <Building2 className="mx-auto h-8 w-8 text-muted" />
            <p className="mt-3 text-sm font-medium">No companies yet</p>
            <p className="text-sm text-muted">Add companies above or import them from Contacts.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Company ({companies.length})</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="group border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    {editId === c.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && void saveEdit(c.id)}
                          className="max-w-sm"
                          autoFocus
                        />
                        <button
                          onClick={() => void saveEdit(c.id)}
                          className="text-brand hover:opacity-80"
                          title="Save"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="text-muted hover:text-ink"
                          title="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <span className="font-medium">{c.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editId !== c.id && (
                      <div className="flex items-center justify-end gap-3 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => {
                            setEditId(c.id);
                            setEditName(c.name);
                          }}
                          className="text-muted hover:text-brand"
                          title="Rename"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => void remove(c.id)}
                          className="text-muted hover:text-red-600"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
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
