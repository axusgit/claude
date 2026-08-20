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

// Axus logo, embedded inline (cid) so it renders in every mail client without
// hotlinking. Loaded once at startup from the runtime assets/ dir.
const LOGO_CID = "axuslogo";
let logo: Buffer | null = null;
try {
  logo = readFileSync(join(process.cwd(), "assets", "axus-logo.png"));
} catch {
  /* logo optional — fall back to the wordmark */
}

type MailAttachment = { filename: string; content: Buffer; cid?: string; contentDisposition?: "inline" | "attachment" };

// Merge the inline logo into any per-message attachments.
function withLogo(extra: MailAttachment[] = []): MailAttachment[] {
  const list = [...extra];
  if (logo) list.push({ filename: "axus-logo.png", content: logo, cid: LOGO_CID, contentDisposition: "inline" });
  return list;
}

function header(): string {
  return logo
    ? '<img src="cid:' + LOGO_CID + '" alt="Axus Technologies" width="120" style="display:block;width:120px;height:auto;border:0;margin-bottom:18px;" />'
    : '<div style="font-size:13px;font-weight:700;letter-spacing:.02em;color:#111827;margin-bottom:18px;">AXUS <span style="color:#ea580c;">eSIGN</span></div>';
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
    '<tr><td style="padding:14px 34px 26px;"><p style="margin:0;font-size:12px;color:#9ca3af;">Axus Technologies · This is a secure document from Axus eSign.</p></td></tr>' +
    "</table></td></tr></table></div>"
  );
}

function button(url: string, label: string): string {
  return (
    '<a href="' + url + '" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;' +
    'font-size:15px;font-weight:600;padding:12px 26px;border-radius:8px;">' + label + "</a>"
  );
}

export async function sendSigningInvite(opts: {
  to: string;
  recipientName: string;
  senderName: string;
  title: string;
  url: string;
}): Promise<boolean> {
  const html = shell(
    "You have a document to sign",
    '<p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#374151;">Hi ' +
      opts.recipientName +
      ',</p><p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:#374151;"><strong>' +
      opts.senderName +
      '</strong> has sent you <strong>' +
      opts.title +
      "</strong> to review and sign.</p>" +
      '<p style="margin:0 0 24px;">' + button(opts.url, "Review & sign") + "</p>" +
      '<p style="margin:0;font-size:13px;color:#9ca3af;">If you weren\'t expecting this, you can ignore this email.</p>',
  );
  const text =
    `Hi ${opts.recipientName},\n\n${opts.senderName} has sent you "${opts.title}" to review and sign.\n\n` +
    `Open it here:\n${opts.url}\n\n— Axus eSign`;
  try {
    await transport.sendMail({ from: config.mail.from, envelope: { from: config.mail.sender, to: opts.to }, to: opts.to, subject: `Please sign: ${opts.title}`, text, html, attachments: withLogo() });
    return true;
  } catch {
    return false;
  }
}

export async function sendCompleted(opts: {
  to: string;
  recipientName: string;
  title: string;
  attachment?: { filename: string; content: Buffer };
}): Promise<boolean> {
  const html = shell(
    "Document completed",
    '<p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#374151;">Hi ' +
      opts.recipientName +
      ',</p><p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#374151;"><strong>' +
      opts.title +
      "</strong> has been signed by all parties. A signed copy is attached for your records, " +
      "including a certificate of completion.</p>",
  );
  const text = `Hi ${opts.recipientName},\n\n"${opts.title}" has been signed by all parties. A signed copy is attached.\n\n— Axus eSign`;
  try {
    await transport.sendMail({
      from: config.mail.from,
      envelope: { from: config.mail.sender, to: opts.to },
      to: opts.to,
      subject: `Completed: ${opts.title}`,
      text,
      html,
      attachments: withLogo(
        opts.attachment
          ? [{ filename: opts.attachment.filename, content: opts.attachment.content }]
          : [],
      ),
    });
    return true;
  } catch {
    return false;
  }
}

export async function sendProgress(opts: {
  to: string;
  recipientName: string;
  title: string;
  signerName: string;
  attachment?: { filename: string; content: Buffer };
}): Promise<boolean> {
  const html = shell(
    "Document update",
    '<p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#374151;">Hi ' +
      opts.recipientName +
      ',</p><p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#374151;"><strong>' +
      opts.signerName +
      "</strong> has completed their part of <strong>" +
      opts.title +
      "</strong>. The current copy is attached; you'll receive the fully-signed version once all parties have signed.</p>",
  );
  const text =
    `Hi ${opts.recipientName},\n\n${opts.signerName} has completed their part of "${opts.title}". ` +
    `The current copy is attached; the fully-signed version follows once all parties sign.\n\n— Axus eSign`;
  try {
    await transport.sendMail({
      from: config.mail.from,
      envelope: { from: config.mail.sender, to: opts.to },
      to: opts.to,
      subject: `Update: ${opts.title}`,
      text,
      html,
      attachments: withLogo(
        opts.attachment
          ? [{ filename: opts.attachment.filename, content: opts.attachment.content }]
          : [],
      ),
    });
    return true;
  } catch {
    return false;
  }
}

// Sent to a participant who hasn't signed yet, once the other party completes.
export async function sendReminder(opts: {
  to: string;
  recipientName: string;
  signerName: string;
  title: string;
  url: string;
}): Promise<boolean> {
  const html = shell(
    "Your signature is needed",
    '<p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#374151;">Hi ' +
      opts.recipientName +
      ',</p><p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:#374151;"><strong>' +
      opts.signerName +
      "</strong> has completed their part of <strong>" +
      opts.title +
      "</strong>. Your signature is now needed to complete it.</p>" +
      '<p style="margin:0 0 8px;">' + button(opts.url, "Complete your part") + "</p>",
  );
  const text =
    `Hi ${opts.recipientName},\n\n${opts.signerName} has completed their part of "${opts.title}". ` +
    `Your signature is now needed to complete it:\n${opts.url}\n\n— Axus eSign`;
  try {
    await transport.sendMail({
      from: config.mail.from,
      envelope: { from: config.mail.sender, to: opts.to },
      to: opts.to,
      subject: `Signature needed: ${opts.title}`,
      text,
      html,
      attachments: withLogo(),
    });
    return true;
  } catch {
    return false;
  }
}

// Periodic reminder (scheduled) to a signer who hasn't completed yet.
export async function sendPendingReminder(opts: {
  to: string;
  recipientName: string;
  title: string;
  url: string;
}): Promise<boolean> {
  const html = shell(
    "Reminder: your signature is needed",
    '<p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#374151;">Hi ' +
      opts.recipientName +
      ',</p><p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:#374151;">This is a friendly reminder that <strong>' +
      opts.title +
      "</strong> is awaiting your signature.</p>" +
      '<p style="margin:0 0 8px;">' + button(opts.url, "Complete your part") + "</p>",
  );
  const text =
    `Hi ${opts.recipientName},\n\nReminder: "${opts.title}" is awaiting your signature.\n${opts.url}\n\n— Axus eSign`;
  try {
    await transport.sendMail({
      from: config.mail.from,
      envelope: { from: config.mail.sender, to: opts.to },
      to: opts.to,
      subject: `Reminder — signature needed: ${opts.title}`,
      text,
      html,
      attachments: withLogo(),
    });
    return true;
  } catch {
    return false;
  }
}
