// Centered confirm / prompt dialogs (Axus convention — never native confirm/
// alert/prompt). Mount <ConfirmHost/> once near the app root; call confirmDialog()
// or promptDialog() anywhere.
import { useEffect, useState } from "react";
import { Button, Input, Modal } from "@/components/ui";

type ConfirmOpts = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

let open: ((opts: ConfirmOpts, resolve: (v: boolean) => void) => void) | null = null;

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    if (open) open(opts, resolve);
    else resolve(false);
  });
}

export function ConfirmHost() {
  const [state, setState] = useState<{ opts: ConfirmOpts; resolve: (v: boolean) => void } | null>(null);

  useEffect(() => {
    open = (opts, resolve) => setState({ opts, resolve });
    return () => {
      open = null;
    };
  }, []);

  if (!state) return null;
  const { opts, resolve } = state;
  const done = (v: boolean) => {
    resolve(v);
    setState(null);
  };
  return (
    <Modal title={opts.title} onClose={() => done(false)}>
      {opts.message && <p className="mb-4 text-sm text-muted">{opts.message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => done(false)}>
          {opts.cancelLabel ?? "Cancel"}
        </Button>
        <Button variant={opts.danger ? "danger" : "primary"} onClick={() => done(true)}>
          {opts.confirmLabel ?? "Confirm"}
        </Button>
      </div>
    </Modal>
  );
}

type PromptOpts = {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
};
let openPrompt: ((opts: PromptOpts, resolve: (v: string | null) => void) => void) | null = null;

// Resolves with the entered text, or null if cancelled.
export function promptDialog(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => {
    if (openPrompt) openPrompt(opts, resolve);
    else resolve(null);
  });
}

export function PromptHost() {
  const [state, setState] = useState<{ opts: PromptOpts; resolve: (v: string | null) => void } | null>(null);
  const [val, setVal] = useState("");

  useEffect(() => {
    openPrompt = (opts, resolve) => {
      setVal(opts.defaultValue ?? "");
      setState({ opts, resolve });
    };
    return () => {
      openPrompt = null;
    };
  }, []);

  if (!state) return null;
  const { opts, resolve } = state;
  const done = (v: string | null) => {
    resolve(v);
    setState(null);
  };
  return (
    <Modal title={opts.title} onClose={() => done(null)}>
      {opts.message && <p className="mb-3 text-sm text-muted">{opts.message}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          done(val.trim() ? val.trim() : null);
        }}
      >
        <Input autoFocus value={val} placeholder={opts.placeholder} onChange={(e) => setVal(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => done(null)}>
            Cancel
          </Button>
          <Button type="submit">{opts.confirmLabel ?? "OK"}</Button>
        </div>
      </form>
    </Modal>
  );
}
