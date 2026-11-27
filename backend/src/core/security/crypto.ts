import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';

/** Chiffrement applicatif AES-256-GCM : `v1.<iv>.<tag>.<texte chiffré>` (base64url). */
export function encryptString(keyBase64: string, plaintext: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('Clé AES-256 invalide (32 octets attendus)');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptString(keyBase64: string, payload: string): string {
  const [version, iv, tag, ct] = payload.split('.');
  if (version !== VERSION || !iv || !tag || !ct) throw new Error('Format de donnée chiffrée inconnu');
  const key = Buffer.from(keyBase64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
