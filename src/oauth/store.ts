import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { hashToken, nowSeconds, randomId } from './crypto.js';

export type OAuthClient = {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string | null;
  redirect_uris: string[];
  grant_types: string[];
  token_endpoint_auth_method: string;
  scope: string | null;
  created_at: number;
};

export type Connection = {
  id: string;
  username: string;
  password_encrypted: string;
  label: string | null;
  created_at: number;
  last_used_at: number | null;
};

export type AuthCode = {
  code_hash: string;
  client_id: string;
  connection_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string | null;
  resource: string | null;
  expires_at: number;
};

export type TokenRow = {
  token_hash: string;
  connection_id: string;
  client_id: string;
  scope: string | null;
  resource: string | null;
  expires_at: number;
};

export type OAuthStore = {
  createClient: (c: Omit<OAuthClient, 'created_at'>) => OAuthClient;
  getClient: (id: string) => OAuthClient | null;
  createConnection: (username: string, passwordEncrypted: string, label?: string) => Connection;
  getConnection: (id: string) => Connection | null;
  touchConnection: (id: string) => void;
  saveAuthCode: (c: Omit<AuthCode, 'code_hash'> & { code: string }, signingKey: string) => void;
  consumeAuthCode: (code: string, signingKey: string) => AuthCode | null;
  saveAccessToken: (token: string, row: Omit<TokenRow, 'token_hash'>, signingKey: string) => void;
  saveRefreshToken: (token: string, row: Omit<TokenRow, 'token_hash'>, signingKey: string) => void;
  getAccessToken: (token: string, signingKey: string) => TokenRow | null;
  getRefreshToken: (token: string, signingKey: string) => TokenRow | null;
  revokeRefreshToken: (token: string, signingKey: string) => void;
  close: () => void;
};

export const createOAuthStore = (dbPath: string): OAuthStore => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_secret_hash TEXT,
      client_name TEXT,
      redirect_uris TEXT NOT NULL,
      grant_types TEXT NOT NULL,
      token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
      scope TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_encrypted TEXT NOT NULL,
      label TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS auth_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL,
      scope TEXT,
      resource TEXT,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS access_tokens (
      token_hash TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      scope TEXT,
      resource TEXT,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      scope TEXT,
      resource TEXT,
      expires_at INTEGER NOT NULL
    );
  `);

  const hydrateClient = (row: Record<string, unknown> | undefined): OAuthClient | null => {
    if (!row) return null;
    return {
      client_id: String(row.client_id),
      client_secret_hash: (row.client_secret_hash as string | null) ?? null,
      client_name: (row.client_name as string | null) ?? null,
      redirect_uris: JSON.parse(String(row.redirect_uris)) as string[],
      grant_types: JSON.parse(String(row.grant_types)) as string[],
      token_endpoint_auth_method: String(row.token_endpoint_auth_method),
      scope: (row.scope as string | null) ?? null,
      created_at: Number(row.created_at),
    };
  };

  return {
    createClient: (c) => {
      const created_at = nowSeconds();
      db.prepare(
        `INSERT INTO oauth_clients (client_id, client_secret_hash, client_name, redirect_uris, grant_types, token_endpoint_auth_method, scope, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        c.client_id,
        c.client_secret_hash,
        c.client_name,
        JSON.stringify(c.redirect_uris),
        JSON.stringify(c.grant_types),
        c.token_endpoint_auth_method,
        c.scope,
        created_at,
      );
      return { ...c, created_at };
    },

    getClient: (id) =>
      hydrateClient(db.prepare(`SELECT * FROM oauth_clients WHERE client_id = ?`).get(id) as Record<string, unknown>),

    createConnection: (username, passwordEncrypted, label) => {
      const row: Connection = {
        id: randomId(),
        username,
        password_encrypted: passwordEncrypted,
        label: label ?? null,
        created_at: nowSeconds(),
        last_used_at: null,
      };
      db.prepare(
        `INSERT INTO connections (id, username, password_encrypted, label, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      ).run(row.id, row.username, row.password_encrypted, row.label, row.created_at);
      return row;
    },

    getConnection: (id) =>
      (db.prepare(`SELECT * FROM connections WHERE id = ?`).get(id) as Connection | undefined) ?? null,

    touchConnection: (id) => {
      db.prepare(`UPDATE connections SET last_used_at = ? WHERE id = ?`).run(nowSeconds(), id);
    },

    saveAuthCode: (c, signingKey) => {
      db.prepare(
        `INSERT INTO auth_codes (code_hash, client_id, connection_id, redirect_uri, code_challenge, code_challenge_method, scope, resource, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        hashToken(c.code, signingKey),
        c.client_id,
        c.connection_id,
        c.redirect_uri,
        c.code_challenge,
        c.code_challenge_method,
        c.scope,
        c.resource,
        c.expires_at,
      );
    },

    consumeAuthCode: (code, signingKey) => {
      const h = hashToken(code, signingKey);
      const row = db.prepare(`SELECT * FROM auth_codes WHERE code_hash = ?`).get(h) as AuthCode | undefined;
      if (!row) return null;
      db.prepare(`DELETE FROM auth_codes WHERE code_hash = ?`).run(h);
      if (row.expires_at < nowSeconds()) return null;
      return row;
    },

    saveAccessToken: (token, row, signingKey) => {
      db.prepare(
        `INSERT INTO access_tokens (token_hash, connection_id, client_id, scope, resource, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(hashToken(token, signingKey), row.connection_id, row.client_id, row.scope, row.resource, row.expires_at);
    },

    saveRefreshToken: (token, row, signingKey) => {
      db.prepare(
        `INSERT INTO refresh_tokens (token_hash, connection_id, client_id, scope, resource, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(hashToken(token, signingKey), row.connection_id, row.client_id, row.scope, row.resource, row.expires_at);
    },

    getAccessToken: (token, signingKey) => {
      const row = db
        .prepare(`SELECT * FROM access_tokens WHERE token_hash = ?`)
        .get(hashToken(token, signingKey)) as TokenRow | undefined;
      if (!row || row.expires_at < nowSeconds()) return null;
      return row;
    },

    getRefreshToken: (token, signingKey) => {
      const row = db
        .prepare(`SELECT * FROM refresh_tokens WHERE token_hash = ?`)
        .get(hashToken(token, signingKey)) as TokenRow | undefined;
      if (!row || row.expires_at < nowSeconds()) return null;
      return row;
    },

    revokeRefreshToken: (token, signingKey) => {
      db.prepare(`DELETE FROM refresh_tokens WHERE token_hash = ?`).run(hashToken(token, signingKey));
    },

    close: () => db.close(),
  };
};
