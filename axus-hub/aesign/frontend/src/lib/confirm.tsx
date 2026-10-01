// Promise-based, centered confirm dialog — a drop-in replacement for
// window.confirm(), which browsers pin to the top of the window. Renders its own
// React root so it can be called imperatively from anywhere (no provider needed).
import { createRoot } from "react-dom/client";
import { Button } from "../components/ui";

export function alertDialog(opts: { message: string; title?: string; okText?: string }): Promise<void> {
  return confirmDialog({ message: opts.message, title: opts.title, confirmText: opts.okText ?? "OK", hideCancel: true }).then(
    () => undefined,
  );
}

export function confirmDialog(opts: {
  message: string;
  title?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  hideCancel?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(false);
    };
    const done = (v: boolean) => {
      document.removeEventListener("keydown", onKey);
      // Defer unmount so we don't unmount during this root's own event dispatch.
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
      resolve(v);
    };
    document.addEventListener("keydown", onKey);
    root.render(
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) done(false);
        }}
      >
        <div className="glass-card w-full max-w-md rounded-[var(--radius-card)] p-6">
          {opts.title && <h2 className="mb-2 text-lg font-semibold text-ink">{opts.title}</h2>}
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{opts.message}</p>
          <div className="mt-6 flex justify-end gap-2">
            {!opts.hideCancel && (
              <Button variant="outline" onClick={() => done(false)}>
                {opts.cancelText ?? "Cancel"}
              </Button>
            )}
            <Button variant={opts.danger ? "danger" : "primary"} onClick={() => done(true)} autoFocus>
              {opts.confirmText ?? "OK"}
            </Button>
          </div>
        </div>
      </div>,
    );
  });
}
