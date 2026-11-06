import { useState } from "react";
import { Upload, FileText, FolderTree, ShieldAlert, Check } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { buildPreview, parseCsv, type ImportPreview } from "@/lib/csv";
import { useVault } from "@/lib/vault";

export function ImportPage() {
  const { importEntries, isAdmin } = useVault();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<number | null>(null);

  if (!isAdmin) {
    return <Card className="p-8 text-center text-sm text-muted">Only vault admins can import.</Card>;
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setResult(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const p = buildPreview(rows);
      if (p.entries.length === 0) setErr("No entries found. Is this a KeePass CSV export with a header row?");
      setPreview(p);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not read the file");
    }
    e.target.value = "";
  }

  async function doImport() {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    try {
      const n = await importEntries(preview.entries);
      setResult(n);
      setPreview(null);
      setFileName("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const colName = (i: number) => (i >= 0 ? "✓ mapped" : "— not found");

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <Upload className="h-5 w-5 text-brand" />
          <h2 className="text-base font-semibold">Import from KeePass (CSV)</h2>
        </div>
        <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <ShieldAlert className="mb-1 inline h-4 w-4" /> The CSV is read and <strong>encrypted in your browser</strong> —
          plaintext never reaches the server. <strong>Delete / shred the CSV file</strong> from your computer right after
          importing. Export it from KeePass as <em>File → Export → CSV</em> (columns: Group, Title, Username, Password, URL, Notes).
        </div>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-canvas px-4 py-6 text-sm text-muted hover:border-brand hover:text-brand">
          <FileText className="h-5 w-5" />
          {fileName || "Choose a .csv file…"}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        </label>
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        {result !== null && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">
            <Check className="h-4 w-4" /> Imported {result} entr{result === 1 ? "y" : "ies"}. You can now delete the CSV file.
          </div>
        )}
      </Card>

      {preview && preview.entries.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Preview</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat n={preview.entries.length} label="entries" />
            <Stat n={preview.folderPaths.length} label="folders" />
            <Stat n={preview.skipped} label="skipped rows" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {(["title", "username", "password", "url", "notes", "totp", "group"] as const).map((k) => (
              <div key={k} className="flex justify-between">
                <span className="capitalize text-muted">{k}</span>
                <span className={preview.columns[k] >= 0 ? "text-green-600" : "text-muted"}>{colName(preview.columns[k])}</span>
              </div>
            ))}
          </div>
          {preview.folderPaths.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
                <FolderTree className="h-3.5 w-3.5" /> Folders to create
              </div>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-line p-2 text-xs text-ink">
                {preview.folderPaths.map((p) => (
                  <div key={p} className="font-mono">{p}</div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setPreview(null); setFileName(""); }}>Cancel</Button>
            <Button onClick={doImport} disabled={busy}>{busy ? "Importing…" : `Import ${preview.entries.length} entries`}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-lg border border-line py-3">
      <div className="text-xl font-semibold tabular-nums">{n}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
