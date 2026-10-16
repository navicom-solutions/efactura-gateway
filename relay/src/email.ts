import { EmailMessage } from 'cloudflare:email';
import type { Notifier } from './handler.js';
import { formatReport, subjectOf } from './notify.js';

const encodeHeader = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  return `=?UTF-8?B?${btoa(String.fromCharCode(...bytes))}?=`;
};

/** Cloudflare Email Routing binding; `to` must be a verified destination address. */
export const emailNotifier =
  (binding: SendEmail, from: string, to: string): Notifier =>
  async (report) => {
    const domain = from.split('@')[1] ?? 'localhost';
    const raw = [
      `From: efactura-gateway feedback <${from}>`,
      `To: ${to}`,
      `Subject: ${encodeHeader(subjectOf(report))}`,
      `Message-ID: <${report.id}@${domain}>`,
      `Date: ${new Date(report.received_at).toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      formatReport(report),
    ].join('\r\n');
    await binding.send(new EmailMessage(from, to, raw));
  };
