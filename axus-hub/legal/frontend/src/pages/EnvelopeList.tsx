import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, FileSignature, Plus, Trash2 } from "lucide-react";
import { api, type Envelope } from "@/lib/api";
import { Button, Card, Input, StatusBadge } from "@/components/ui";

export function EnvelopeList() {
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const nav = useNavigate();

  async function load() {
    setLoading(true);
    try {
      setEnvelopes(await api.listEnvelopes());
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

  async function create() {
    if (!title.trim()) return;
    const env = await api.createEnvelope(title.trim());
    nav(`/envelopes/${env.id}`);
  }

  async function del(docId: string, docTitle: string) {
    if (
      !window.confirm(
        `Delete "${docTitle}"? This permanently removes the document and its audit trail.`,
      )
    )
      return;
    try {
      await api.deleteEnvelope(docId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Documents</h1>
          <p className="text-sm text-muted">Send SOWs, MSAs, and contracts for signature.</p>
        </div>
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus className="h-4 w-4" /> New document
        </Button>
      </div>

      {creating && (
        <Card className="p-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium">Document title</label>
              <Input
                autoFocus
                placeholder="e.g. BCOM Master Services Agreement"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void create()}
              />
            </div>
            <Button onClick={() => void create()} disabled={!title.trim()}>
              Create &amp; open
            </Button>
          </div>
        </Card>
      )}

      <Card>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted">Loading…</div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-red-600">{error}</div>
        ) : envelopes.length === 0 ? (
          <div className="p-12 text-center">
            <FileSignature className="mx-auto h-8 w-8 text-muted" />
            <p className="mt-3 text-sm font-medium">No documents yet</p>
            <p className="text-sm text-muted">Create your first document to get started.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {envelopes.map((e) => (
                <tr
                  key={e.id}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-canvas"
                  onClick={() => nav(`/envelopes/${e.id}`)}
                >
                  <td className="px-4 py-3 font-medium">{e.title}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {new Date(e.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      {e.pdf_file && (
                        <a
                          href={api.documentUrl(e.id)}
                          target="_blank"
                          rel="noopener"
                          onClick={(ev) => ev.stopPropagation()}
                          className="text-muted hover:text-brand"
                          title={
                            e.status === "completed" ? "Download signed document" : "Download document"
                          }
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      )}
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void del(e.id, e.title);
                        }}
                        className="text-muted hover:text-red-600"
                        title="Delete document"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
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
