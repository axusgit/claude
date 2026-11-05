// Centered confirm dialog (Axus convention — never native confirm/alert).
// Mount <ConfirmHost/> once near the app root; call confirmDialog() anywhere.
import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";

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
