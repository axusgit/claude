import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Circle, Download, FileSignature, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { api, companiesApi, type Company, type Envelope } from "@/lib/api";
import { Button, Card, Input, StatusBadge } from "@/components/ui";

const DOC_TYPES = ["SOW", "MSA", "SOW & MSA", "BAA", "Quote"];
// Types that auto-attach a stored template on creation (Quotes are generated separately).
const TEMPLATE_TYPES = ["BAA"];

export function EnvelopeList() {
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function resend(e: Envelope) {
    try {
      const r = await api.resendEnvelope(e.id);
      setNotice(`Resent the signing link to ${r.sent} recipient(s).`);
      setTimeout(() => setNotice(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resend failed");
    }
  }

  // Bulk cleanup by document age.
  const PURGE_OPTIONS = [
    { days: 90, label: "90 days" },
    { days: 183, label: "183 days" },
    { days: 365, label: "1 year" },
    { days: 1095, label: "3 years" },
    { days: 1825, label: "5 years" },
    { days: 3650, label: "10 years" },
  ];
  const [showPurge, setShowPurge] = useState(false);
  const [purgeDays, setPurgeDays] = useState(365);
  const [purgeCount, setPurgeCount] = useState<number | null>(null);
  const [purging, setPurging] = useState(false);

  async function loadPurgeCount(days: number) {
    setPurgeCount(null);
    try {
      setPurgeCount((await api.purgePreview(days)).count);
    } catch {
      setPurgeCount(null);
    }
  }
  function openPurge() {
    setShowPurge(true);
    void loadPurgeCount(purgeDays);
  }
  async function doPurge() {
    setPurging(true);
    try {
      const r = await api.purgeOld(purgeDays);
      setShowPurge(false);
      setNotice(`Deleted ${r.deleted} document(s) older than the selected age.`);
      setTimeout(() => setNotice(null), 4000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setPurging(false);
    }
  }
  const [creating, setCreating] = useState(false);
  const [docType, setDocType] = useState("SOW");
  const [company, setCompany] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [editDoc, setEditDoc] = useState<Envelope | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editType, setEditType] = useState("SOW");
  const [editCompany, setEditCompany] = useState("");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const nav = useNavigate();

  const filtered = envelopes.filter((e) => {
    if (filterType !== "all" && (e.doc_type ?? "") !== filterType) return false;
    if (filterStatus !== "all" && e.status !== filterStatus) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!`${e.title} ${e.company ?? ""}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

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
    companiesApi.list().then(setCompanies).catch(() => {});
  }, []);

  async function create() {
    if (!company.trim()) return;
    if (docType === "Quote") {
      nav(`/quotes/new?company=${encodeURIComponent(company.trim())}`);
      return;
    }
    // Template-backed types (BAA) are DEFERRED — open the editor in "new" mode
    // showing the filled template; nothing is saved until the user clicks Save.
    if (TEMPLATE_TYPES.includes(docType)) {
      nav(
        `/envelopes/new?doc_type=${encodeURIComponent(docType)}&company=${encodeURIComponent(company.trim())}`,
      );
      return;
    }
    // Upload-based types (SOW / MSA / SOW & MSA): no title is asked — a
    // placeholder is used until the uploaded document's file name replaces it.
    const env = await api.createEnvelope({
      title: `${company.trim()} ${docType}`,
      doc_type: docType,
      company: company.trim(),
    });
    nav(`/envelopes/${env.id}`);
  }

  function openEdit(e: Envelope) {
    setEditDoc(e);
    setEditTitle(e.title);
    setEditType(e.doc_type ?? "SOW");
    setEditCompany(e.company ?? "");
  }
  async function saveEdit() {
    if (!editDoc || !editTitle.trim() || !editCompany.trim()) return;
    try {
      await api.updateEnvelope(editDoc.id, {
        title: editTitle.trim(),
        doc_type: editType,
        company: editCompany.trim(),
      });
      setEditDoc(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Documents</h1>
          <p className="text-sm text-muted">Send SOWs, MSAs, and contracts for signature.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openPurge}>
            <Trash2 className="h-4 w-4" /> Delete old…
          </Button>
          <Button onClick={() => setCreating((v) => !v)}>
            <Plus className="h-4 w-4" /> New document
          </Button>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</div>
      )}
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {creating && (
        <Card className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Document</label>
              <p className="pt-2 text-sm text-muted">
                {docType === "Quote"
                  ? "You'll build the quote on the next step."
                  : TEMPLATE_TYPES.includes(docType)
                    ? `The ${docType} template opens pre-filled with the company & date — nothing is saved until you click Save.`
                    : "You'll upload the document next — its file name becomes the title."}
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Type</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
              >
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid items-end gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Company</label>
              {companies.length > 0 && (
                <select
                  value=""
                  onChange={(e) => e.target.value && setCompany(e.target.value)}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                >
                  <option value="">Pick from your companies…</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <Input
                placeholder="Company name"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <Button
              className="w-fit"
              onClick={() => void create()}
              disabled={!company.trim()}
            >
              {docType === "Quote" || TEMPLATE_TYPES.includes(docType) ? "Continue" : "Create & open"}
            </Button>
          </div>
        </Card>
      )}

      {!loading && !error && envelopes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Search title or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 max-w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-lg border border-line bg-white px-2 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="all">All types</option>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-line bg-white px-2 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="partially_completed">Partially Completed</option>
            <option value="completed">Completed</option>
            <option value="declined">Declined</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
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
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    No documents match your search.
                  </td>
                </tr>
              )}
              {filtered.map((e) => (
                <tr
                  key={e.id}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-canvas"
                  onClick={() => nav(`/envelopes/${e.id}`)}
                >
                  <td className="px-4 py-3 font-medium">{e.title}</td>
                  <td className="px-4 py-3">
                    {e.doc_type ? (
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                        {e.doc_type}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{e.company ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="group relative inline-block">
                      <StatusBadge status={e.status} />
                      {e.recipients && e.recipients.length > 0 && (
                        <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-max min-w-[190px] rounded-lg border border-line bg-white p-2 text-xs shadow-lg group-hover:block">
                          {e.recipients.map((r, i) => (
                            <span key={i} className="flex items-center gap-1.5 py-0.5">
                              {r.status === "signed" ? (
                                <Check className="h-3 w-3 shrink-0 text-green-600" />
                              ) : (
                                <Circle className="h-3 w-3 shrink-0 text-muted" />
                              )}
                              <span className={r.status === "signed" ? "text-ink" : "text-muted"}>
                                {r.name}
                              </span>
                              <span className="ml-auto pl-3 text-muted">
                                {r.status === "signed" ? "signed" : "not signed"}
                              </span>
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {new Date(e.created_at).toLocaleString([], {
                      month: "numeric",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          openEdit(e);
                        }}
                        className="text-muted hover:text-brand"
                        title="Edit title, type, company"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {(e.status === "sent" || e.status === "partially_completed") && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void resend(e);
                          }}
                          className="text-muted hover:text-brand"
                          title="Resend the signing link to anyone who hasn't signed"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      )}
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

      {editDoc && (
        <div
          className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4"
          onClick={() => setEditDoc(null)}
        >
          <div
            className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 font-semibold">Edit document</h3>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Title</label>
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Type</label>
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value)}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                >
                  {DOC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Company</label>
                {companies.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => e.target.value && setEditCompany(e.target.value)}
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                  >
                    <option value="">Pick from your companies…</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                <Input
                  value={editCompany}
                  onChange={(e) => setEditCompany(e.target.value)}
                  placeholder="Company name"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditDoc(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => void saveEdit()}
                disabled={!editTitle.trim() || !editCompany.trim()}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {showPurge && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-white p-5">
            <h3 className="font-semibold">Delete old documents</h3>
            <p className="mt-1 text-sm text-muted">
              Permanently delete every document older than the selected age — including its files and
              audit trail. This cannot be undone.
            </p>
            <label className="mt-3 block text-sm font-medium">Older than</label>
            <select
              value={purgeDays}
              onChange={(e) => {
                const d = Number(e.target.value);
                setPurgeDays(d);
                void loadPurgeCount(d);
              }}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
            >
              {PURGE_OPTIONS.map((o) => (
                <option key={o.days} value={o.days}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="mt-3 rounded-lg bg-canvas p-3 text-sm">
              {purgeCount === null ? (
                "Counting…"
              ) : (
                <span>
                  <span className="font-semibold text-red-700">{purgeCount}</span> document
                  {purgeCount === 1 ? "" : "s"} will be permanently deleted.
                </span>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowPurge(false)} disabled={purging}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => void doPurge()}
                disabled={purging || !purgeCount}
              >
                {purging ? "Deleting…" : `Delete ${purgeCount ?? 0}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
