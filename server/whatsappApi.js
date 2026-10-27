// Talks to WhatsApp through Meta's Cloud API: send text and reply buttons, download photos people send.
// Setup lives in Vercel env vars: WHATSAPP_TOKEN (access token), WHATSAPP_PHONE_ID (the bot's phone number id).

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';
const graphUrl = (path) => `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;

export const whatsappConfigured = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);

const auth = () => ({ Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` });

async function post(message) {
  const res = await fetch(graphUrl(`${process.env.WHATSAPP_PHONE_ID}/messages`), {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...message }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(`WhatsApp send failed (${res.status}): ${detail?.error?.message ?? 'unknown error'}`);
  }
}

/** Plain text message. WhatsApp allows up to 4096 characters. */
export const sendText = (to, text) => post({ to, type: 'text', text: { body: text.slice(0, 4096), preview_url: false } });

/** Text with up to 3 tap-to-reply buttons: [{ id, title }] (titles max 20 characters). */
export const sendButtons = (to, text, buttons) =>
  post({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: text.slice(0, 1024) },
      action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
    },
  });

/** Downloads a photo someone sent. Media ids stay valid for a while, so this also works at send time. */
export async function downloadMedia(mediaId) {
  const meta = await fetch(graphUrl(mediaId), { headers: auth(), signal: AbortSignal.timeout(10_000) });
  if (!meta.ok) throw new Error(`WhatsApp media lookup failed (${meta.status})`);
  const { url, mime_type: mimeType } = await meta.json();
  const file = await fetch(url, { headers: auth(), signal: AbortSignal.timeout(15_000) });
  if (!file.ok) throw new Error(`WhatsApp media download failed (${file.status})`);
  return { base64: Buffer.from(await file.arrayBuffer()).toString('base64'), mimeType: mimeType || 'image/jpeg' };
}
