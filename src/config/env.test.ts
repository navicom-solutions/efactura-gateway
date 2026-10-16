import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from './env.js';

const base = { API_KEY: 'k', EFACTURA_ENDPOINT: 'https://example.test/Service.svc' };

describe('loadEnv PUBLIC_URL', () => {
  it('prefers an explicit PUBLIC_URL', () => {
    const env = loadEnv({ ...base, PUBLIC_URL: 'https://own.example', RENDER_EXTERNAL_URL: 'https://x.onrender.com' });
    assert.equal(env.PUBLIC_URL, 'https://own.example');
  });

  it('falls back to the Render external URL', () => {
    const env = loadEnv({ ...base, RENDER_EXTERNAL_URL: 'https://x.onrender.com' });
    assert.equal(env.PUBLIC_URL, 'https://x.onrender.com');
  });

  it('treats an empty PUBLIC_URL as unset', () => {
    const env = loadEnv({ ...base, PUBLIC_URL: '', RENDER_EXTERNAL_URL: 'https://x.onrender.com' });
    assert.equal(env.PUBLIC_URL, 'https://x.onrender.com');
  });

  it('defaults to localhost when nothing is set', () => {
    assert.equal(loadEnv(base).PUBLIC_URL, 'http://127.0.0.1:3000');
  });
});
