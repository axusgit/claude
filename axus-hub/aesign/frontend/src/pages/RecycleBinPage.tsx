import { useEffect, useState } from "react";
import { Archive, Download, RotateCcw, Search, Trash2 } from "lucide-react";
import { api, type Envelope } from "@/lib/api";
import { Card, Input, SortHeader, StatusBadge } from "@/components/ui";
import { confirmDialog } from "@/lib/confirm";
import { dirCmp, useSort } from "@/lib/sort";

const DOC_TYPES = ["SOW", "MSA", "SOW & MSA", "BAA", "SLA", "Certificate of Completion", "Quote", "Others"];

type BinSortKey = "title" | "type" | "company" | "status" | "deleted" | "autoarchive";

// Days a document is kept in the bin before it's automatically moved to the
// Archive (a protection for deleted docs — nothing is ever auto-destroyed).
const RETENTION_DAYS = 90;

export function RecycleBinPage() {
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const { key: sort, dir, toggle } = useSort<BinSortKey>("deleted", "desc");

  async function load() {
    setLoading(true);
    try {
      setEnvelopes(await api.listDeleted());
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
      await api.restoreFromBin(docId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    }
  }

  async function archive(docId: string) {
    try {
      await api.archiveEnvelope(docId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Archive failed");
    }
  }

  async function purge(docId: string, docTitle: string) {
    if (
      !(await confirmDialog({
        title: "Permanently delete",
        message: `Permanently delete "${docTitle}"? This cannot be undone — it removes the document, its files, and its audit trail.`,
        confirmText: "Delete permanently",
        danger: true,
      }))
    )
      return;
    try {
      await api.purgeEnvelope(docId);
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

  // Whole days remaining before the doc is auto-moved to the Archive (min 0).
  const daysLeft = (deletedAt?: string | null) => {
    if (!deletedAt) return RETENTION_DAYS;
    const elapsed = (Date.now() - new Date(deletedAt).getTime()) / 86400000;
    return Math.max(0, Math.ceil(RETENTION_DAYS - elapsed));
  };

  const sortVal = (e: Envelope): string | number =>
    ({
      title: e.title,
      type: e.doc_type ?? "",
      company: e.company ?? "",
      status: e.status,
      deleted: Date.parse(e.deleted_at ?? "") || 0,
      autoarchive: daysLeft(e.deleted_at),
    })[sort];
  const sorted = [...filtered].sort(
    (a, b) => dirCmp(sortVal(a), sortVal(b), dir) || a.title.localeCompare(b.title),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Recycle Bin</h1>
        <p className="text-sm text-muted">
          Deleted documents are kept here for {RETENTION_DAYS} days, then automatically moved to the
          Archive for safekeeping — they're never destroyed automatically. Restore one to the
          Documents tab, move it to the Archive now, or delete it forever.
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
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
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
            <Trash2 className="mx-auto h-8 w-8 text-muted" />
            <p className="mt-3 text-sm font-medium">The Recycle Bin is empty</p>
            <p className="text-sm text-muted">
              Deleting a document from the Documents or Archive tab moves it here.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted">No documents match your search.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <SortHeader
                  label="Title"
                  active={sort === "title"}
                  dir={dir}
                  onClick={() => toggle("title")}
                  suffix={<span className="ml-1 normal-case tracking-normal text-muted">({filtered.length})</span>}
                />
                <SortHeader label="Type" active={sort === "type"} dir={dir} onClick={() => toggle("type")} />
                <SortHeader label="Company" active={sort === "company"} dir={dir} onClick={() => toggle("company")} />
                <SortHeader label="Status" active={sort === "status"} dir={dir} onClick={() => toggle("status")} />
                <SortHeader label="Deleted" active={sort === "deleted"} dir={dir} onClick={() => toggle("deleted")} />
                <SortHeader label="Auto-archive" active={sort === "autoarchive"} dir={dir} onClick={() => toggle("autoarchive")} />
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id} className="group border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{e.title}</td>
                  <td className="px-4 py-3 text-muted">{e.doc_type ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{e.company ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{when(e.deleted_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    in {daysLeft(e.deleted_at)} day{daysLeft(e.deleted_at) === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => void restore(e.id)}
                        className="text-muted hover:text-brand"
                        title="Restore to Documents"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => void archive(e.id)}
                        className="text-muted hover:text-brand"
                        title="Move to Archive"
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                      {e.pdf_file && (
                        <a
                          href={api.documentUrl(e.id)}
                          target="_blank"
                          rel="noopener"
                          className="text-muted hover:text-brand"
                          title="Download document"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      )}
                      <button
                        onClick={() => void purge(e.id, e.title)}
                        className="text-muted hover:text-red-600"
                        title="Delete forever"
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
