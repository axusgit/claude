import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";

export function Button({
  className,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none px-3.5 py-2";
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-brand text-brand-fg hover:bg-brand-hover",
    outline: "border border-line bg-surface text-ink hover:bg-canvas",
    ghost: "text-ink hover:bg-canvas",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return <button className={cn(base, variants[variant], className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-[var(--radius-card)] border border-line bg-surface shadow-sm", className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-[38px] w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-ink", className)} {...props} />;
}

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      {children}
    </span>
  );
}

// Centered modal shell (Axus convention: never native confirm/alert).
export function Modal({
  title,
  children,
  onClose,
  width = "max-w-md",
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={cn(
          "max-h-[90vh] w-full overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-xl",
          width,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-base font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}
