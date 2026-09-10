"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Inline editor to set an item's TD SYNNEX SKU. Once saved, the catalog prices
// by that SKU (which resolves reliably where a CDW/mfg part number does not).
export function SkuEditor({ id, initial }: { id: string; initial: string }) {
  const router = useRouter();
  const [val, setVal] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(false);

  async function save() {
    setSaving(true);
    setErr(false);
    setSaved(false);
    try {
      const res = await fetch("/admin/catalog/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, synnexSKU: val.trim() }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      router.refresh(); // re-pull live pricing with the new SKU
    } catch {
      setErr(true);
    }
    setSaving(false);
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        value={val}
        onChange={(e) => {
          setVal(e.target.value);
          setSaved(false);
          setErr(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !saving) save();
        }}
        placeholder="SKU or Mfg Part #"
        className="w-36 rounded border border-line bg-canvas/60 px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-accent"
      />
      <button
        onClick={save}
        disabled={saving}
        className={
          "rounded border px-2 py-1 text-[11px] font-medium transition-all " +
          (saved
            ? "border-ok bg-ok/20 text-ok"
            : saving
              ? "border-line text-muted opacity-60"
              : "border-line text-muted hover:border-accent hover:text-accent")
        }
      >
        {saving ? "…" : err ? "Retry" : saved ? "✓ Saved" : "Save"}
      </button>
    </div>
  );
}
