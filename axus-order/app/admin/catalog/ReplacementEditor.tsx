"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Admin editor for an item's replacement part (a TD SYNNEX SKU or mfg part number)
// plus an optional friendly name. When set, the customer is offered it as an
// accept-able replacement in the catalog.
export function ReplacementEditor({
  id,
  initialSku,
  initialName,
}: {
  id: string;
  initialSku: string;
  initialName: string;
}) {
  const router = useRouter();
  const [sku, setSku] = useState(initialSku);
  const [name, setName] = useState(initialName);
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
        body: JSON.stringify({ id, replacementSku: sku.trim(), replacementName: name.trim() }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      router.refresh();
    } catch {
      setErr(true);
    }
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        value={sku}
        onChange={(e) => {
          setSku(e.target.value);
          setSaved(false);
          setErr(false);
        }}
        placeholder="Repl. part #"
        className="w-32 rounded border border-line bg-canvas/60 px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-accent"
      />
      <div className="flex items-center gap-1.5">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
            setErr(false);
          }}
          placeholder="Label (optional)"
          className="w-32 rounded border border-line bg-canvas/60 px-2 py-1 text-[11px] text-ink outline-none focus:border-accent"
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
    </div>
  );
}
