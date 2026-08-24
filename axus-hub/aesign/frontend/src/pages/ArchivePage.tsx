import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, ArchiveRestore, Copy, Download, Search, Trash2 } from "lucide-react";
import { api, type Envelope } from "@/lib/api";
import { Card, Input, StatusBadge } from "@/components/ui";

const DOC_TYPES = ["SOW", "MSA", "SOW & MSA", "BAA", "Quote"];

export function ArchivePage() {
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const nav = useNavigate();

  async function load() {
    setLoading(true);
    try {
      setEnvelopes(await api.listEnvelopes(true));
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

  async function restore(docId: string) {
    try {
      await api.restoreEnvelope(docId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    }
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

  const filtered = envelopes.filter((e) => {
    if (filterType !== "all" && (e.doc_type ?? "") !== filterType) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!`${e.title} ${e.company ?? ""}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const when = (d?: string | null) =>
    d
      ? new Date(d).toLocaleString([], {
          month: "numeric",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "—";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Archive</h1>
        <p className="text-sm text-muted">
          Archived documents. Download or permanently delete them here.
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or company…"
            className="pl-9"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
        >
          <option value="all">All types</option>
          {DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <Card>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted">Loading…</div>
        ) : envelopes.length === 0 ? (
          <div className="p-12 text-center">
            <Archive className="mx-auto h-8 w-8 text-muted" />
            <p className="mt-3 text-sm font-medium">Nothing archived yet</p>
            <p className="text-sm text-muted">
              Archive old documents from the Documents tab and they'll appear here.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted">No documents match your search.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Title ({filtered.length})</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Archived</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="group border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{e.title}</td>
                  <td className="px-4 py-3 text-muted">{e.doc_type ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{e.company ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{when(e.archived_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => void restore(e.id)}
                        className="text-muted hover:text-brand"
                        title="Restore to Documents"
                      >
                        <ArchiveRestore className="h-4 w-4" />
                      </button>
                      {e.doc_type === "Quote" && (
                        <button
                          onClick={() => nav(`/quotes/new?from=${e.id}`)}
                          className="text-muted hover:text-brand"
                          title="Duplicate this quote (reuse its line items)"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      )}
                      {e.pdf_file && (
                        <a
                          href={api.documentUrl(e.id)}
                          target="_blank"
                          rel="noopener"
                          className="text-muted hover:text-brand"
                          title={
                            e.status === "completed" ? "Download signed document" : "Download document"
                          }
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      )}
                      <button
                        onClick={() => void del(e.id, e.title)}
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
