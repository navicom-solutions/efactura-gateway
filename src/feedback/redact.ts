/**
 * Masks personal and business data in free text before it leaves the server.
 * Shared by the gateway and the relay, so it must stay dependency-free.
 * Order matters: specific patterns run before the generic digit and token rules.
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(pass(?:word)?|parol[aă]|token|secret|api[_ -]?key|authorization)(\s*[:=]\s*)\S+?(?=[.,;]?(?:\s|$))/gi, '$1$2[redacted]'],
  [/\bBearer\s+\S+/gi, 'Bearer [redacted]'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, '[iban]'],
  [/\b\d{13}\b/g, '[idno]'],
  [/(?:\+|\b00)\d[\d\s-]{7,14}\d\b/g, '[phone]'],
  [/\b0\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g, '[phone]'],
  [/\b[A-Z]{3}\s?-?\d{5,10}\b/g, '[invoice]'],
  [/\b\d{8,}\b/g, '[number]'],
  [/\b[A-Za-z0-9_-]{32,}\b/g, '[token]'],
];

export const redact = (text: string): string =>
  RULES.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
