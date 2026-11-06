import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

const transport = nodemailer.createTransport({
  host: config.mail.host,
  port: config.mail.port,
  secure: false, // STARTTLS on 587
  auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
});

export type SendResult = { success: boolean; messageId?: string; error?: string };

async function runSend(to: string, message: nodemailer.SendMailOptions): Promise<SendResult> {
  if (!config.mail.host) return { success: false, error: "SMTP not configured" };
  try {
    const info = await transport.sendMail(message);
    const rejected = Array.isArray(info.rejected) ? info.rejected.map(String) : [];
    return {
      success: rejected.length === 0,
      messageId: info.messageId,
      error: rejected.length ? `Rejected: ${rejected.join(", ")}` : undefined,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("ATRS mail send failed:", error);
    return { success: false, error };
  }
}

// Axus logo, embedded inline (cid) so it renders without hotlinking.
const LOGO_CID = "axuslogo";
let logo: Buffer | null = null;
try {
  logo = readFileSync(join(process.cwd(), "assets", "axus-logo.png"));
} catch {
  /* logo optional — fall back to the wordmark */
}
type MailAttachment = { filename: string; content: Buffer; cid?: string; contentDisposition?: "inline" | "attachment" };
function logoAttachment(): MailAttachment[] {
  return logo ? [{ filename: "axus-logo.png", content: logo, cid: LOGO_CID, contentDisposition: "inline" }] : [];
}
function header(): string {
  return logo
    ? '<img src="cid:' + LOGO_CID + '" alt="Axus Technologies" width="120" style="display:block;width:120px;height:auto;border:0;margin-bottom:18px;" />'
    : '<div style="font-size:13px;font-weight:700;letter-spacing:.02em;color:#111827;margin-bottom:18px;">AXUS <span style="color:#ea580c;">TIME</span></div>';
}
function shell(title: string, bodyHtml: string): string {
  return (
    '<div style="margin:0;padding:0;background:#f4f5f7;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:10px;font-family:Inter,Segoe UI,Arial,sans-serif;overflow:hidden;">' +
    '<tr><td style="height:4px;background:#ea580c;"></td></tr>' +
    '<tr><td style="padding:28px 34px 8px;">' +
    header() +
    '<h1 style="margin:0 0 12px;font-size:19px;font-weight:700;color:#111827;">' + title + "</h1>" +
    bodyHtml +
    "</td></tr>" +
    '<tr><td style="padding:14px 34px 26px;"><p style="margin:0;font-size:12px;color:#9ca3af;">Axus Technologies · Time Reporting System</p></td></tr>' +
    "</table></td></tr></table></div>"
  );
}
function button(url: string, label: string): string {
  return (
    '<a href="' + url + '" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;' +
    'font-size:15px;font-weight:600;padding:12px 26px;border-radius:8px;">' + label + "</a>"
  );
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br />");
}

// A contractor submitted time → notify the approver.
export async function sendSubmitted(opts: {
  to: string;
  workerName: string;
  count: number;
  totalHours: number;
  rangeLabel: string;
  url: string;
}): Promise<SendResult> {
  const summary =
    `<strong>${esc(opts.workerName)}</strong> submitted <strong>${opts.count}</strong> time ` +
    `entr${opts.count === 1 ? "y" : "ies"} (<strong>${opts.totalHours}</strong> hour${opts.totalHours === 1 ? "" : "s"}) ` +
    `for <strong>${esc(opts.rangeLabel)}</strong> and is awaiting your approval.`;
  const html = shell(
    "Time submitted for approval",
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#374151;">${summary}</p>` +
      '<p style="margin:0 0 8px;">' + button(opts.url, "Review & approve") + "</p>",
  );
  const text =
    `${opts.workerName} submitted ${opts.count} time entr${opts.count === 1 ? "y" : "ies"} ` +
    `(${opts.totalHours} h) for ${opts.rangeLabel} and is awaiting approval.\n\nReview: ${opts.url}\n\n— Axus Time Reporting`;
  return runSend(opts.to, {
    from: config.mail.from,
    envelope: { from: config.mail.sender, to: opts.to },
    to: opts.to,
    subject: `Time approval needed: ${opts.workerName} — ${opts.rangeLabel}`,
    text,
    html,
    attachments: logoAttachment(),
  });
}

// Weekly nudge to the approver: everything currently awaiting approval, grouped
// by contractor. Sent once a week (cron) after the Sun–Sat work week closes.
export async function sendWeeklyApproverReminder(opts: {
  to: string;
  weekLabel: string; // e.g. "Nov 2 – Nov 8, 2026"
  totalCount: number;
  totalHours: number;
  perWorker: { name: string; count: number; hours: number }[];
  url: string;
}): Promise<SendResult> {
  const row = (label: string, count: string, hours: string, strong = false) => {
    const top = strong ? "border-top:1px solid #e5e7eb;padding-top:8px;" : "";
    const w = strong ? "700" : "400";
    const ink = strong ? "#111827" : "#374151";
    return (
      `<tr><td style="padding:6px 0;${top}font-size:14px;font-weight:${w};color:${ink};">${label}</td>` +
      `<td style="padding:6px 0;${top}font-size:14px;color:${ink};text-align:right;white-space:nowrap;">${count}</td>` +
      `<td style="padding:6px 0 6px 18px;${top}font-size:14px;font-weight:700;color:#111827;text-align:right;white-space:nowrap;">${hours} h</td></tr>`
    );
  };
  const body = opts.perWorker
    .map((w) => row(esc(w.name), `${w.count} entr${w.count === 1 ? "y" : "ies"}`, String(w.hours)))
    .join("");
  const table =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 18px;">' +
    body +
    row("Total", `${opts.totalCount} entr${opts.totalCount === 1 ? "y" : "ies"}`, String(opts.totalHours), true) +
    "</table>";
  const html = shell(
    "Timesheets awaiting your approval",
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#374151;">The work week of ` +
      `<strong>${esc(opts.weekLabel)}</strong> has closed. <strong>${opts.totalCount}</strong> timesheet ` +
      `entr${opts.totalCount === 1 ? "y is" : "ies are"} awaiting your approval ` +
      `(<strong>${opts.totalHours}</strong> hour${opts.totalHours === 1 ? "" : "s"} total).</p>` +
      table +
      '<p style="margin:0 0 8px;">' + button(opts.url, "Review & approve") + "</p>",
  );
  const text =
    `The work week of ${opts.weekLabel} has closed. ${opts.totalCount} timesheet ` +
    `entr${opts.totalCount === 1 ? "y is" : "ies are"} awaiting your approval (${opts.totalHours} h total).\n\n` +
    opts.perWorker.map((w) => `  • ${w.name}: ${w.count} entr${w.count === 1 ? "y" : "ies"}, ${w.hours} h`).join("\n") +
    `\n\nReview & approve: ${opts.url}\n\n— Axus Time Reporting`;
  return runSend(opts.to, {
    from: config.mail.from,
    envelope: { from: config.mail.sender, to: opts.to },
    to: opts.to,
    subject: `Weekly timesheet approvals — ${opts.weekLabel} (${opts.totalCount} pending)`,
    text,
    html,
    attachments: logoAttachment(),
  });
}

// An admin approved or rejected time → notify the contractor.
export async function sendDecision(opts: {
  to: string;
  workerName: string;
  approved: boolean;
  count: number;
  totalHours: number;
  rangeLabel: string;
  note?: string;
  url: string;
}): Promise<SendResult> {
  const verb = opts.approved ? "approved" : "returned (not approved)";
  const noteHtml = opts.note?.trim()
    ? '<div style="border-left:3px solid #ea580c;background:#fff7ed;padding:10px 14px;font-size:14px;color:#374151;border-radius:0 8px 8px 0;margin:0 0 8px;"><strong>Note:</strong><br />' +
      esc(opts.note.trim()) + "</div>"
    : "";
  const html = shell(
    opts.approved ? "Your time was approved" : "Your time needs changes",
    `<p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#374151;">Hi ${esc(opts.workerName)},</p>` +
      `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#374151;">Your <strong>${opts.count}</strong> ` +
      `time entr${opts.count === 1 ? "y" : "ies"} (<strong>${opts.totalHours}</strong> h) for ` +
      `<strong>${esc(opts.rangeLabel)}</strong> ${opts.approved ? "have been" : "were"} <strong>${verb}</strong>.</p>` +
      noteHtml +
      (opts.approved ? "" : '<p style="margin:0 0 8px;">' + button(opts.url, "Update & resubmit") + "</p>"),
  );
  const text =
    `Hi ${opts.workerName},\n\nYour ${opts.count} time entr${opts.count === 1 ? "y" : "ies"} (${opts.totalHours} h) ` +
    `for ${opts.rangeLabel} ${opts.approved ? "have been" : "were"} ${verb}.` +
    (opts.note?.trim() ? `\n\nNote:\n${opts.note.trim()}` : "") +
    (opts.approved ? "" : `\n\nUpdate & resubmit: ${opts.url}`) +
    `\n\n— Axus Time Reporting`;
  return runSend(opts.to, {
    from: config.mail.from,
    envelope: { from: config.mail.sender, to: opts.to },
    to: opts.to,
    subject: opts.approved
      ? `Time approved: ${opts.rangeLabel}`
      : `Time returned for changes: ${opts.rangeLabel}`,
    text,
    html,
    attachments: logoAttachment(),
  });
}
