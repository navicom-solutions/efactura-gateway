import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export const randomId = (bytes = 16): string => randomBytes(bytes).toString('hex');

export const hashToken = (token: string, signingKey: string): string =>
  createHmac('sha256', signingKey).update(token).digest('hex');

export const safeEqual = (a: string, b: string): boolean => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
};

export const verifyPkceS256 = (verifier: string, challenge: string): boolean => {
  const computed = createHash('sha256').update(verifier).digest('base64url');
  return safeEqual(computed, challenge);
};

/** AES-256-GCM; key = first 32 bytes of hex ENCRYPTION_KEY (or sha256 of raw). */
const keyBytes = (encryptionKey: string): Buffer => {
  if (/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    return Buffer.from(encryptionKey, 'hex');
  }
  return createHash('sha256').update(encryptionKey).digest();
};

export const encrypt = (plaintext: string, encryptionKey: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(encryptionKey), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
};

export const decrypt = (payload: string, encryptionKey: string): string => {
  const buf = Buffer.from(payload, 'base64url');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(encryptionKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
};
