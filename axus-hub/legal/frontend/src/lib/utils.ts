import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Distinct colors per recipient (by index), used to tint their fields.
const RECIPIENT_COLORS = [
  "#ea580c", // brand orange
  "#2563eb", // blue
  "#16a34a", // green
  "#9333ea", // purple
  "#db2777", // pink
  "#0891b2", // cyan
];

export function recipientColor(index: number): string {
  return RECIPIENT_COLORS[index % RECIPIENT_COLORS.length];
}
