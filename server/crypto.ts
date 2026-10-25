import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function digest(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function seal(value: unknown, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(secret, 'base64'), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((v) => v.toString('base64url')).join('.');
}
export function unseal<T>(value: string, secret: string): T {
  const [iv, tag, data] = value.split('.').map((v) => Buffer.from(v, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(secret, 'base64'), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8'));
}
