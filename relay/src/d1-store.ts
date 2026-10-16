import type { ReportStore, StoredReport } from './handler.js';

const COLUMNS = [
  'id',
  'received_at',
  'kind',
  'summary',
  'details',
  'tool',
  'error_code',
  'gateway_version',
  'instance',
  'ip_hash',
] as const;

const COUNT_SQL = {
  instance: 'SELECT COUNT(*) AS n FROM reports WHERE instance = ? AND received_at >= ?',
  ip_hash: 'SELECT COUNT(*) AS n FROM reports WHERE ip_hash = ? AND received_at >= ?',
} as const;

export const createD1Store = (db: D1Database): ReportStore => ({
  countSince: async (field, value, sinceIso) =>
    (await db.prepare(COUNT_SQL[field]).bind(value, sinceIso).first<number>('n')) ?? 0,

  findDuplicate: async (instance, summary, sinceIso) =>
    db
      .prepare('SELECT id FROM reports WHERE instance = ? AND lower(summary) = lower(?) AND received_at >= ? LIMIT 1')
      .bind(instance, summary, sinceIso)
      .first<string>('id'),

  insert: async (report) => {
    await db
      .prepare(`INSERT INTO reports (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`)
      .bind(...COLUMNS.map((c) => report[c] ?? null))
      .run();
  },

  recent: async (limit) => {
    const { results } = await db
      .prepare(`SELECT ${COLUMNS.join(', ')} FROM reports ORDER BY received_at DESC LIMIT ?`)
      .bind(limit)
      .all<StoredReport>();
    return results;
  },
});
