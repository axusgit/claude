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
    outline: "border border-line bg-white text-ink hover:bg-canvas",
    ghost: "text-ink hover:bg-canvas",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return <button className={cn(base, variants[variant], className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-[var(--radius-card)] border border-line bg-white", className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-ink", className)} {...props} />;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  voided: "bg-red-100 text-red-700",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
        STATUS_STYLES[status] ?? "bg-gray-100 text-gray-700",
      )}
    >
      {status}
    </span>
  );
}
