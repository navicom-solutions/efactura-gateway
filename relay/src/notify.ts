import type { Notifier, StoredReport } from './handler.js';

const KIND_LABELS: Record<StoredReport['kind'], string> = {
  bug: 'Bug',
  feature_request: 'Feature request',
  question: 'Question',
};

export const subjectOf = (r: StoredReport): string => `efactura-gateway ${KIND_LABELS[r.kind]}: ${r.summary}`;

export const formatReport = (r: StoredReport): string =>
  [
    subjectOf(r),
    '',
    r.details || '(no details)',
    '',
    [r.tool && `Tool: ${r.tool}`, r.error_code && `Error: ${r.error_code}`].filter(Boolean).join(' · '),
    `Version ${r.gateway_version} · instance ${r.instance} · ${r.received_at}`,
    `Report ${r.id}`,
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n');

export const telegramNotifier =
  (botToken: string, chatId: string, fetchImpl: typeof fetch = fetch): Notifier =>
  async (report) => {
    const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: formatReport(report), disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`);
  };
