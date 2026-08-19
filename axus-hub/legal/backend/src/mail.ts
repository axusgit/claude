import nodemailer from "nodemailer";
import { config } from "./config.js";

const transport = nodemailer.createTransport({
  host: config.mail.host,
  port: config.mail.port,
  secure: false, // STARTTLS on 587
  auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
});

function shell(title: string, bodyHtml: string): string {
  return (
    '<div style="margin:0;padding:0;background:#f4f5f7;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:10px;font-family:Inter,Segoe UI,Arial,sans-serif;overflow:hidden;">' +
    '<tr><td style="height:4px;background:#ea580c;"></td></tr>' +
    '<tr><td style="padding:28px 34px 8px;">' +
    '<div style="font-size:13px;font-weight:700;letter-spacing:.02em;color:#111827;margin-bottom:18px;">AXUS <span style="color:#ea580c;">LEGAL</span></div>' +
    '<h1 style="margin:0 0 12px;font-size:19px;font-weight:700;color:#111827;">' + title + "</h1>" +
    bodyHtml +
    "</td></tr>" +
    '<tr><td style="padding:14px 34px 26px;"><p style="margin:0;font-size:12px;color:#9ca3af;">Axus Technologies · This is a secure document from Axus Legal.</p></td></tr>' +
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
    `Open it here:\n${opts.url}\n\n— Axus Legal`;
  try {
    await transport.sendMail({ from: config.mail.from, to: opts.to, subject: `Please sign: ${opts.title}`, text, html });
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
  const text = `Hi ${opts.recipientName},\n\n"${opts.title}" has been signed by all parties. A signed copy is attached.\n\n— Axus Legal`;
  try {
    await transport.sendMail({
      from: config.mail.from,
      to: opts.to,
      subject: `Completed: ${opts.title}`,
      text,
      html,
      attachments: opts.attachment
        ? [{ filename: opts.attachment.filename, content: opts.attachment.content }]
        : [],
    });
    return true;
  } catch {
    return false;
  }
}
