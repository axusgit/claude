"use client";

// Promise-based, screen-centered confirm/alert — a drop-in replacement for the
// native window.confirm()/alert(), which browsers pin to the TOP of the window.
// Renders its own React root imperatively, so it can be called from anywhere
// (no provider needed): `if (!(await axusConfirm("Delete?"))) return;`
import { createRoot } from "react-dom/client";

type Opts = {
  message: string;
  title?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  hideCancel?: boolean;
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2147483000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "rgba(15,23,42,.45)",
  backdropFilter: "blur(2px)",
  WebkitBackdropFilter: "blur(2px)",
};
const card: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  background: "#fff",
  color: "#0f172a",
  border: "1px solid rgba(0,0,0,.08)",
  borderRadius: 14,
  boxShadow: "0 20px 60px rgba(2,6,23,.35)",
  padding: "22px 22px 18px",
  fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
};
const btn: React.CSSProperties = {
  font: "600 14px/1 Inter, sans-serif",
  padding: "10px 18px",
  borderRadius: 9,
  cursor: "pointer",
  border: "1px solid transparent",
};

function dialog(opts: Opts): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(false);
      else if (e.key === "Enter") done(true);
    };
    const done = (v: boolean) => {
      document.removeEventListener("keydown", onKey);
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
      resolve(v);
    };
    document.addEventListener("keydown", onKey);
    root.render(
      <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) done(false); }}>
        <div style={card} role="alertdialog" aria-modal="true">
          {opts.title && (
            <h2 style={{ fontFamily: "Poppins, Inter, sans-serif", fontWeight: 700, fontSize: 16, margin: "0 0 8px" }}>
              {opts.title}
            </h2>
          )}
          <p style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-line", margin: 0, color: "#334155" }}>
            {opts.message}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
            {!opts.hideCancel && (
              <button
                type="button"
                style={{ ...btn, background: "transparent", borderColor: "rgba(0,0,0,.16)", color: "#475569" }}
                onClick={() => done(false)}
              >
                {opts.cancelText ?? "Cancel"}
              </button>
            )}
            <button
              type="button"
              autoFocus
              style={{
                ...btn,
                color: "#fff",
                background: opts.danger
                  ? "linear-gradient(135deg,#dc2626,#ef4444)"
                  : "linear-gradient(135deg,#f26522,#f7941d)",
                boxShadow: opts.danger ? "0 4px 12px rgba(220,38,38,.35)" : "0 4px 12px rgba(242,101,34,.35)",
              }}
              onClick={() => done(true)}
            >
              {opts.confirmText ?? "OK"}
            </button>
          </div>
        </div>
      </div>,
    );
  });
}

export function axusConfirm(message: string, opts: Omit<Opts, "message"> = {}): Promise<boolean> {
  return dialog({ message, ...opts });
}

export function axusAlert(message: string, opts: { title?: string; okText?: string } = {}): Promise<void> {
  return dialog({ message, title: opts.title, confirmText: opts.okText ?? "OK", hideCancel: true }).then(() => undefined);
}
