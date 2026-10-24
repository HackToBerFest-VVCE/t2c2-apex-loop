// Sends an email from a signed-in user's Gmail (their stored Google sign-in), optionally with a JPEG.
import { randomUUID } from 'node:crypto';
import { accessTokenFor } from './auth.js';

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const wrap76 = (s) => s.replace(/.{76}(?=.)/g, '$&\r\n');

/** RFC 2822 message: UTF-8 text body plus an optional JPEG attachment, base64url for the Gmail API. */
function buildRawMessage({ to, bcc, subject, body, photoBase64 }) {
  const boundary = `civiclens_${randomUUID()}`;
  const lines = [
    `To: ${to}`,
    ...(bcc?.length ? [`Bcc: ${bcc.join(', ')}`] : []), // Gmail removes Bcc before delivery, so recipients stay private
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(body)),
  ];
  if (photoBase64) {
    lines.push(
      `--${boundary}`,
      'Content-Type: image/jpeg; name="issue-photo.jpg"',
      'Content-Disposition: attachment; filename="issue-photo.jpg"',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(photoBase64)
    );
  }
  lines.push(`--${boundary}--`, '');
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, kind: 'signin' | 'config' | 'busy' | 'gmail', error: string }>}
 */
export async function gmailSend(session, { to, bcc, subject, body, photoBase64 }) {
  let accessToken;
  try {
    accessToken = await accessTokenFor(session);
  } catch (err) {
    console.error('[gmail] token refresh failed', err.message);
    if (err.signin) return { ok: false, kind: 'signin', error: 'Your Google sign-in has expired. Please sign in again.' };
    if (err.config) {
      return { ok: false, kind: 'config', error: 'Gmail sending is misconfigured on the server (Google client ID/secret).' };
    }
    return { ok: false, kind: 'busy', error: "Couldn't reach Google. Please try again." };
  }

  const raw = buildRawMessage({ to, bcc, subject, body, photoBase64 });
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    console.error('[gmail] send error', res.status, detail?.error?.message);
    return { ok: false, kind: 'gmail', error: `Gmail couldn't send the email (${detail?.error?.message ?? res.status}).` };
  }
  return { ok: true };
}
