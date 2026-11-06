import { useState } from "react";
import { KeyRound, Lock, ShieldAlert, Download, Copy, Check } from "lucide-react";
import { Button, Card, Input, Label, Textarea } from "@/components/ui";
import { useVault } from "@/lib/vault";
import type { Me } from "@/lib/api";
import logo from "@/assets/axus-logo.png";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <img src={logo} alt="Axus Technologies" className="h-8 w-auto" />
          <span className="text-sm font-semibold text-muted">Password Management</span>
        </div>
        <Card className="p-6">{children}</Card>
      </div>
    </div>
  );
}

export function LockScreen({ me }: { me: Me }) {
  if (!me.vaultInitialized) {
    return me.role === "admin" ? <CreateVault /> : <NotReady />;
  }
  return <Unlock isAdmin={me.role === "admin"} />;
}

function NotReady() {
  return (
    <Shell>
      <div className="text-center">
        <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-amber-500" />
        <h2 className="text-base font-semibold">Vault not set up yet</h2>
        <p className="mt-2 text-sm text-muted">
          An Axus vault administrator needs to create the password vault before anyone can sign in. Please check
          back shortly.
        </p>
      </div>
    </Shell>
  );
}

function Unlock({ isAdmin }: { isAdmin: boolean }) {
  const { unlock, recover } = useVault();
  const [mode, setMode] = useState<"unlock" | "recover">("unlock");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // recover
  const [recKey, setRecKey] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");

  async function doUnlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await unlock(pass);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Unlock failed");
      setPass("");
    } finally {
      setBusy(false);
    }
  }

  async function doRecover(e: React.FormEvent) {
    e.preventDefault();
    if (newPass.length < 12) return setErr("New passphrase must be at least 12 characters.");
    if (newPass !== newPass2) return setErr("New passphrases don't match.");
    setBusy(true);
    setErr(null);
    try {
      await recover(recKey, newPass);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Recovery failed");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "recover") {
    return (
      <Shell>
        <h2 className="mb-1 text-base font-semibold">Recover the vault</h2>
        <p className="mb-4 text-sm text-muted">
          Paste the offline recovery key and set a new shared passphrase. This re-establishes access without
          re-encrypting any data.
        </p>
        <form onSubmit={doRecover} className="space-y-3">
          <div>
            <Label>Recovery key</Label>
            <Textarea rows={3} value={recKey} onChange={(e) => setRecKey(e.target.value)} className="mt-1 font-mono text-xs" placeholder="Base64 recovery key…" />
          </div>
          <div>
            <Label>New passphrase</Label>
            <Input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Confirm new passphrase</Label>
            <Input type="password" value={newPass2} onChange={(e) => setNewPass2(e.target.value)} className="mt-1" />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="flex-1">
              {busy ? "Recovering…" : "Recover & set passphrase"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setMode("unlock"); setErr(null); }}>
              Back
            </Button>
          </div>
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-4 flex items-center gap-2">
        <Lock className="h-5 w-5 text-brand" />
        <h2 className="text-base font-semibold">Unlock the vault</h2>
      </div>
      <form onSubmit={doUnlock} className="space-y-3">
        <div>
          <Label>Vault passphrase</Label>
          <Input
            type="password"
            autoFocus
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            className="mt-1"
            placeholder="Shared vault passphrase"
          />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <Button type="submit" disabled={busy || !pass} className="w-full">
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-muted">
        The passphrase is never sent to the server — it unlocks the vault in your browser.
      </p>
      {isAdmin && (
        <div className="mt-2 text-center">
          <button className="text-xs text-brand hover:underline" onClick={() => { setMode("recover"); setErr(null); }}>
            Forgot the passphrase? Use the recovery key
          </button>
        </div>
      )}
    </Shell>
  );
}

function CreateVault() {
  const { createVault } = useVault();
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function doCreate(e: React.FormEvent) {
    e.preventDefault();
    if (pass.length < 12) return setErr("Passphrase must be at least 12 characters.");
    if (pass !== pass2) return setErr("Passphrases don't match.");
    setBusy(true);
    setErr(null);
    try {
      const key = await createVault(pass);
      setRecoveryKey(key);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not create the vault");
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const blob = new Blob(
      [
        "Axus Password Management System (APMS) — VAULT RECOVERY KEY\n",
        "Keep this offline and secure. It can decrypt the entire vault if the\n",
        "shared passphrase is ever lost. Anyone with this key can recover access.\n\n",
        recoveryKey ?? "",
        "\n",
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "apms-recovery-key.txt";
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  }

  if (recoveryKey) {
    return (
      <Shell>
        <div className="mb-3 flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-brand" />
          <h2 className="text-base font-semibold">Save the recovery key</h2>
        </div>
        <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          This is shown <strong>once</strong>. Store it offline (password manager, sealed envelope, secrets vault).
          If the shared passphrase is ever lost, this key is the only way to recover the vault.
        </div>
        <Textarea readOnly rows={4} value={recoveryKey} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <div className="mt-3 flex gap-2">
          <Button variant="outline" onClick={() => { navigator.clipboard.writeText(recoveryKey); setCopied(true); }} className="flex-1">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="outline" onClick={download} className="flex-1">
            <Download className="h-4 w-4" /> Download
          </Button>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I have saved the recovery key somewhere safe.
        </label>
        <Button className="mt-3 w-full" disabled={!saved} onClick={() => window.location.reload()}>
          Continue to the vault
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <h2 className="mb-1 text-base font-semibold">Create the vault</h2>
      <p className="mb-4 text-sm text-muted">
        Set the <strong>shared vault passphrase</strong>. Everyone authorized unlocks the vault with it. It is
        never sent to the server — choose something strong and share it with the team through a secure channel.
      </p>
      <form onSubmit={doCreate} className="space-y-3">
        <div>
          <Label>Vault passphrase</Label>
          <Input type="password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} className="mt-1" placeholder="At least 12 characters" />
        </div>
        <div>
          <Label>Confirm passphrase</Label>
          <Input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} className="mt-1" />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Creating…" : "Create vault"}
        </Button>
      </form>
    </Shell>
  );
}
