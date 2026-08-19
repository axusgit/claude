import { useEffect, useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { contactsApi, type Contact } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";

export function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [adding, setAdding] = useState(false);

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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Contacts</h1>
        <p className="text-sm text-muted">
          Save people you send documents to, so you can pick them instead of retyping.
        </p>
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
