import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type IdempotencyStatus = 'in_flight' | 'succeeded' | 'failed' | 'ambiguous';

export type IdempotencyRecord = {
  readonly key: string;
  readonly requestHash: string;
  readonly status: IdempotencyStatus;
  readonly httpStatus: number | null;
  readonly responseJson: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/**
 * Ledger for write operations.
 *
 * Why: SFS eFactura often times out under month-end load AFTER accepting the
 * invoice. Blind retries create duplicates. We remember outcomes by
 * Idempotency-Key (or document external id) and refuse auto-replay of ambiguous writes.
 */
export type BeginResult =
  | { readonly tag: 'acquired' }
  | { readonly tag: 'conflict' }
  | { readonly tag: 'existing'; readonly record: IdempotencyRecord };

export type IdempotencyStore = {
  readonly get: (key: string) => IdempotencyRecord | undefined;
  readonly begin: (key: string, requestHash: string) => BeginResult;
  /** Re-open a definitive failure so the same key+hash can attempt again. */
  readonly reopenFailed: (key: string, requestHash: string) => boolean;
  /**
   * Explicit operator escape after manual reconcile proved the invoice was NOT created.
   * Requires header X-Confirm-Absent: true on the client.
   */
  readonly reopenAmbiguous: (key: string, requestHash: string) => boolean;
  readonly complete: (
    key: string,
    status: Exclude<IdempotencyStatus, 'in_flight'>,
    httpStatus: number,
    responseJson: string,
  ) => void;
  readonly close: () => void;
};

export const createIdempotencyStore = (dbPath: string): IdempotencyStore => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS idempotency (
      key TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      http_status INTEGER,
      response_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const getStmt = db.prepare(
    `SELECT key, request_hash AS requestHash, status, http_status AS httpStatus,
            response_json AS responseJson, created_at AS createdAt, updated_at AS updatedAt
     FROM idempotency WHERE key = ?`,
  );

  const insertStmt = db.prepare(
    `INSERT INTO idempotency (key, request_hash, status, http_status, response_json, created_at, updated_at)
     VALUES (@key, @requestHash, 'in_flight', NULL, NULL, @now, @now)`,
  );

  const updateStmt = db.prepare(
    `UPDATE idempotency
     SET status = @status, http_status = @httpStatus, response_json = @responseJson, updated_at = @now
     WHERE key = @key`,
  );

  const reopenStmt = db.prepare(
    `UPDATE idempotency
     SET status = 'in_flight', http_status = NULL, response_json = NULL, updated_at = @now
     WHERE key = @key AND request_hash = @requestHash AND status = 'failed'`,
  );

  const reopenAmbiguousStmt = db.prepare(
    `UPDATE idempotency
     SET status = 'in_flight', http_status = NULL, response_json = NULL, updated_at = @now
     WHERE key = @key AND request_hash = @requestHash AND status = 'ambiguous'`,
  );

  return {
    get: (key) => getStmt.get(key) as IdempotencyRecord | undefined,

    begin: (key, requestHash) => {
      const existing = getStmt.get(key) as IdempotencyRecord | undefined;
      if (existing) {
        if (existing.requestHash !== requestHash) return { tag: 'conflict' };
        return { tag: 'existing', record: existing };
      }
      const now = new Date().toISOString();
      try {
        insertStmt.run({ key, requestHash, now });
        return { tag: 'acquired' };
      } catch {
        const again = getStmt.get(key) as IdempotencyRecord | undefined;
        if (!again) return { tag: 'conflict' };
        if (again.requestHash !== requestHash) return { tag: 'conflict' };
        return { tag: 'existing', record: again };
      }
    },

    reopenFailed: (key, requestHash) =>
      reopenStmt.run({ key, requestHash, now: new Date().toISOString() }).changes > 0,

    reopenAmbiguous: (key, requestHash) =>
      reopenAmbiguousStmt.run({ key, requestHash, now: new Date().toISOString() }).changes > 0,

    complete: (key, status, httpStatus, responseJson) => {
      updateStmt.run({
        key,
        status,
        httpStatus,
        responseJson,
        now: new Date().toISOString(),
      });
    },

    close: () => db.close(),
  };
};

export const hashRequestBody = (body: unknown): string => {
  const json = JSON.stringify(body);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a_${(h >>> 0).toString(16)}`;
};
