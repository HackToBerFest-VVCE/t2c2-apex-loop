// POST /api/send — sends the complaint from the signed-in user's Gmail, with the photo attached.
import { COMPLAINT_EMAIL } from '../src/lib/constants.js';
import { authConfigured } from './auth.js';
import { gmailSend } from './gmail.js';
import { endSessionCookie, readSession } from './session.js';

const MAX_PHOTO_BASE64 = 4_000_000; // Vercel accepts ~4.5 MB request bodies; app photos are ~0.3–0.6 MB
const STATUS_FOR = { signin: 401, config: 500, busy: 502, gmail: 502 };

export async function send({ method, body, cookies }) {
  if (method !== 'POST') return { status: 405, json: { error: 'Use POST.' } };
  if (!authConfigured()) return { status: 501, json: { error: 'Gmail sending is not set up on the server.', kind: 'config' } };

  const session = readSession(cookies);
  if (!session) return { status: 401, json: { error: 'Please sign in with Google first.', kind: 'signin' } };

  const { subject, body: text, photo } = body ?? {};
  if (typeof subject !== 'string' || !subject.trim() || typeof text !== 'string' || !text.trim()) {
    return { status: 400, json: { error: 'The complaint is empty.', kind: 'bad_request' } };
  }
  const photoBase64 = typeof photo === 'string' ? photo.replace(/^data:[^,]*,/, '') : null;
  if (photoBase64 && photoBase64.length > MAX_PHOTO_BASE64) {
    return { status: 413, json: { error: 'The photo is too large to attach.', kind: 'bad_request' } };
  }

  // Recipient is fixed on the server (test inbox for now), so this endpoint can't be used to email anyone else.
  const result = await gmailSend(session, { to: COMPLAINT_EMAIL, subject: subject.trim(), body: text, photoBase64 });
  if (!result.ok) {
    return {
      status: STATUS_FOR[result.kind] ?? 502,
      json: { error: result.error, kind: result.kind },
      cookies: result.kind === 'signin' ? [endSessionCookie()] : undefined,
    };
  }
  // The app records the sent complaint in the shared log itself (POST /api/reports, action 'sent').
  return { json: { sent: true, from: session.email, to: COMPLAINT_EMAIL } };
}
