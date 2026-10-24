// Signed-in session kept in an encrypted, HttpOnly cookie — no database needed.
// The cookie holds the user's Google refresh token (which can send Gmail as them), so it is
// encrypted with AES-256-GCM using SESSION_SECRET; the browser can neither read nor alter it.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { clearCookie, cookie } from './http.js';

export const SESSION_COOKIE = 'cl_session';
const SESSION_DAYS = 30; // Google may expire the refresh token sooner (7 days while the app is in Testing mode)

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET is missing or too short');
  return createHash('sha256').update(secret).digest();
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function seal(data) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return b64url(Buffer.concat([iv, cipher.getAuthTag(), enc]));
}

export function unseal(token) {
  try {
    const raw = fromB64url(token);
    const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
  } catch {
    return null; // tampered, old secret, or garbage
  }
}

/** @returns {{ refreshToken: string, email: string, name: string, picture?: string } | null} */
export function readSession(cookies) {
  const token = cookies[SESSION_COOKIE];
  return token ? unseal(token) : null;
}

export const sessionCookie = (data) => cookie(SESSION_COOKIE, seal(data), { maxAge: SESSION_DAYS * 86400 });
export const endSessionCookie = () => clearCookie(SESSION_COOKIE);

/** Admins are listed in ADMIN_EMAILS (comma-separated Google account emails). */
export function isAdmin(session) {
  const admins = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(session?.email && admins.includes(session.email.toLowerCase()));
}
