// CivicLens on WhatsApp. A citizen sends a photo, shares the location, taps "Send complaint", and the
// bot emails the same bilingual letter as the web app (from the admin's Gmail, since WhatsApp users
// don't sign in with Google). Reuses the web app's analysis, routing, letters and de-duplication.
//
// Meta calls GET /api/whatsapp once to verify the webhook, then POSTs every incoming message.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { COMPLAINT_EMAIL, SEVERITY_LABEL } from '../src/lib/constants.js';
import { authorityFor } from '../src/lib/authorities.js';
import { normalize } from '../src/lib/normalize.js';
import { englishLetter, englishSubject, escalationEmail, kannadaLetter } from '../src/lib/letters.js';
import { geocodeText, reverseGeocode } from '../src/lib/location.js';
import { handleAnalyze } from './analyze.js';
import { db, dbConfigured } from './db.js';
import { gmailSend } from './gmail.js';
import { addSupporter, botSender, findNearbyOpen, insertSent } from './reports.js';
import { downloadMedia, sendButtons, sendText, whatsappConfigured } from './whatsappApi.js';

/** A chat that has been quiet this long starts over (WhatsApp's own reply window is 24 hours too). */
const CHAT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_THUMB_BASE64 = 88_000; // keeps the stored data URL under the 120 KB thumbnail limit

const EMOJI = {
  Pothole: '🕳️',
  'Road damage': '🚧',
  'Broken streetlight': '💡',
  'Exposed wiring': '⚡',
  'Garbage pile': '🗑️',
  'Overflowing bin': '🗑️',
  'Water leak': '💧',
  'Drainage / sewage': '🚰',
  'Open / damaged manhole': '⚠️',
  Other: '📌',
};

const WELCOME = `👋 Hi! I'm *CivicLens*.

Send me a *photo* of a civic problem — a pothole, broken streetlight, garbage pile, water leak or open manhole — and I'll send a formal complaint to the right office, in English and ಕನ್ನಡ.

ನಾಗರಿಕ ಸಮಸ್ಯೆಯ ಫೋಟೋ ಕಳುಹಿಸಿ, ನಾವು ಸರಿಯಾದ ಕಚೇರಿಗೆ ದೂರು ಕಳುಹಿಸುತ್ತೇವೆ.`;

const ASK_LOCATION = `📍 *Where is it?*
Tap 📎 → *Location* → *Send your current location*.
Or type the area or a landmark, e.g. "Kuvempunagar, Mysuru".`;

// ───────────── Chat memory: Postgres when connected, otherwise this process (local testing) ─────────────

const memory = { chats: new Map(), seen: new Set(), sender: null };

/** True the first time a message id is seen; WhatsApp sometimes delivers a message twice. */
async function firstTime(messageId) {
  if (!dbConfigured()) {
    if (memory.seen.has(messageId)) return false;
    memory.seen.add(messageId);
    return true;
  }
  const sql = await db();
  const rows = await sql`INSERT INTO whatsapp_seen (message_id) VALUES (${messageId}) ON CONFLICT DO NOTHING RETURNING 1`;
  if (Math.random() < 0.02) await sql`DELETE FROM whatsapp_seen WHERE seen_at < now() - interval '7 days'`;
  return rows.length > 0;
}

async function loadChat(phone) {
  let chat;
  if (!dbConfigured()) chat = memory.chats.get(phone);
  else {
    const sql = await db();
    const [row] = await sql`SELECT step, draft, updated_at FROM whatsapp_chats WHERE phone = ${phone}`;
    chat = row && { step: row.step, draft: row.draft, updatedAt: new Date(row.updated_at).getTime() };
  }
  if (!chat || Date.now() - chat.updatedAt > CHAT_TTL_MS) return { step: 'idle', draft: null };
  return chat;
}

async function saveChat(phone, step, draft) {
  if (!dbConfigured()) {
    memory.chats.set(phone, { step, draft, updatedAt: Date.now() });
    return;
  }
  const sql = await db();
  await sql`
    INSERT INTO whatsapp_chats (phone, step, draft, updated_at) VALUES (${phone}, ${step}, ${JSON.stringify(draft)}, now())
    ON CONFLICT (phone) DO UPDATE SET step = EXCLUDED.step, draft = EXCLUDED.draft, updated_at = now()`;
}

const clearChat = (phone) => saveChat(phone, 'idle', null);

/** The admin Google account complaints are sent from (set on the admin page). */
async function sender() {
  if (!dbConfigured()) return memory.sender;
  return botSender(await db());
}

/** For local tests only: there is no database, so the sender is kept in memory. */
export function setTestSender(session) {
  memory.sender = session;
}

// ───────────── Steps of the conversation ─────────────

const shortPlace = (location) => (location || '').split(', ').slice(0, 3).join(', ');

async function onPhoto(phone, image, name) {
  await sendText(phone, '📷 Got it! Checking your photo… (about 10 seconds)');
  const media = await downloadMedia(image.id);
  const { status, json } = await handleAnalyze({ image: media.base64, mimeType: media.mimeType });
  if (status !== 200) {
    await sendText(phone, `😕 ${json.error ?? "Couldn't check the photo."} Please send it again.`);
    return;
  }
  const analysis = normalize(json.result);
  if (!analysis.isCivicIssue) {
    await clearChat(phone);
    await sendText(
      phone,
      `🤔 This doesn't look like a civic problem: ${analysis.description}\n\nPlease send a clear photo of the pothole, streetlight, garbage, leak or manhole.`
    );
    return;
  }
  const draft = { mediaId: image.id, mimeType: media.mimeType, analysis, name, createdAt: new Date().toISOString() };
  await saveChat(phone, 'location', draft);
  await sendText(
    phone,
    `${EMOJI[analysis.issueType] ?? '📌'} *${analysis.issueType}* · ${SEVERITY_LABEL[analysis.severity]} severity\n${analysis.description}\n\n${ASK_LOCATION}`
  );
}

/** Saves the place, then checks for an open complaint at the same spot before offering to send. */
async function onPlace(phone, chat, place) {
  const draft = {
    ...chat.draft,
    location: place.address || '',
    area: place.area ?? null,
    coords: { lat: place.lat, lon: place.lon, accuracy: place.accuracy ?? null, source: place.source },
  };
  if (dbConfigured()) {
    const match = await findNearbyOpen(await db(), {
      lat: place.lat,
      lon: place.lon,
      accuracy: place.accuracy ?? 0,
      department: draft.analysis.department,
    });
    if (match) {
      await saveChat(phone, 'support', { ...draft, matchId: match.id });
      const first = new Date(match.sent_at ?? match.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const people = match.supporters === 1 ? '1 person' : `${match.supporters} people`;
      await sendButtons(
        phone,
        `👥 *Already reported here!* ${people} reported this ${match.issue_type.toLowerCase()} (first on ${first}) and it isn't fixed yet.\n\nAdd your support instead of sending a duplicate? At 3, 5, 10… supporters we email the office again.`,
        [
          { id: 'support', title: 'Add my support' },
          { id: 'new', title: "It's a different one" },
        ]
      );
      return;
    }
  }
  await askToSend(phone, draft);
}

async function askToSend(phone, draft) {
  await saveChat(phone, 'confirm', draft);
  const { analysis } = draft;
  const to = authorityFor({ ...analysis, area: draft.area });
  const where = shortPlace(draft.location) || `${draft.coords.lat.toFixed(5)}, ${draft.coords.lon.toFixed(5)}`;
  await sendButtons(
    phone,
    `✉️ *Ready to send*\n\n${EMOJI[analysis.issueType] ?? '📌'} ${analysis.issueType} · ${SEVERITY_LABEL[analysis.severity]}\n📍 ${where}\n🏛️ To: *${to.name}*\n\nA formal letter in English and ಕನ್ನಡ goes by email, with your photo.`,
    [
      { id: 'send', title: 'Send complaint' },
      { id: 'cancel', title: 'Cancel' },
    ]
  );
}

/** The citizen's photo as an attachment, plus a small copy for the admin page when it fits. */
async function photoFor(draft) {
  try {
    const media = await downloadMedia(draft.mediaId);
    const thumb = media.base64.length <= MAX_THUMB_BASE64 ? `data:${media.mimeType};base64,${media.base64}` : null;
    return { base64: media.base64, thumb };
  } catch (err) {
    console.warn('[whatsapp] photo re-download failed', err.message);
    return { base64: null, thumb: null };
  }
}

async function onSend(phone, chat) {
  const from = await sender();
  if (!from) {
    await sendText(phone, "😕 Sorry, sending isn't set up yet. Please try again later.");
    return;
  }
  const { draft } = chat;
  const report = {
    id: randomUUID(),
    createdAt: draft.createdAt,
    ...draft.analysis,
    location: draft.location,
    area: draft.area,
    coords: draft.coords,
    name: draft.name,
  };
  const to = authorityFor(report);
  const photo = await photoFor(draft);
  const footer = `\n\n--------------------\nSent through CivicLens on behalf of ${draft.name || 'a citizen'}, who reported this on WhatsApp.`;
  const result = await gmailSend(from, {
    to: COMPLAINT_EMAIL,
    subject: englishSubject(report),
    body: `${englishLetter(report)}\n\n--------------------\n\n${kannadaLetter(report)}${footer}`,
    photoBase64: photo.base64,
  });
  if (!result.ok) {
    console.error('[whatsapp] gmail send failed', result.kind, result.error);
    await sendText(phone, "😕 Sorry, the email couldn't be sent right now. Tap *Send complaint* again in a few minutes.");
    return;
  }
  if (dbConfigured()) {
    await insertSent(await db(), { ...report, authority: to.name, thumb: photo.thumb }, { name: draft.name, phone: `+${phone}` });
  }
  await clearChat(phone);
  await sendText(
    phone,
    `✅ *Sent to ${to.name}!*\n\nWe'll message you here when it's fixed. Spot another problem? Just send another photo.\n\nದೂರು ಕಳುಹಿಸಲಾಗಿದೆ. ಧನ್ಯವಾದಗಳು!`
  );
}

async function onSupport(phone, chat) {
  const { draft } = chat;
  const res = await addSupporter(await db(), draft.matchId, { phone: `+${phone}`, name: draft.name, coords: draft.coords });
  if (res.gone) {
    // Fixed or removed in the meantime: send it as a new complaint instead.
    await askToSend(phone, draft);
    return;
  }
  await clearChat(phone);
  if (res.already) {
    await sendText(phone, "👍 You've already reported this one. We'll message you here when it's fixed.");
    return;
  }
  let escalated = false;
  const from = res.escalate ? await sender() : null;
  if (from) {
    const mail = escalationEmail(res.report, res.supporters, draft.name);
    const photo = await photoFor(draft);
    escalated = (await gmailSend(from, { to: COMPLAINT_EMAIL, ...mail, photoBase64: photo.base64 })).ok;
  }
  await sendText(
    phone,
    `👍 *Support added!* ${res.supporters} people have now reported this.${
      escalated ? '\n\n📣 That was a milestone, so we emailed the office again with your photo.' : ''
    }\n\nWe'll message you here when it's fixed.`
  );
}

const YES = /^(yes|y|send|ok|okay|haan|howdu|houdu|ಹೌದು)\b/i;
const NO = /^(no|n|cancel|stop|illa|ಇಲ್ಲ)\b/i;

/** Handles one incoming WhatsApp message. */
async function handleMessage(msg, name) {
  const phone = msg.from;
  const chat = await loadChat(phone);

  if (msg.type === 'image') return onPhoto(phone, msg.image, name);

  if (msg.type === 'location') {
    if (chat.step !== 'location') return sendText(phone, 'Send a photo of the problem first, then the location. 📷');
    const { latitude: lat, longitude: lon } = msg.location;
    let place = { lat, lon, accuracy: null, source: 'whatsapp', address: msg.location.address || '', area: null };
    try {
      place = { ...place, ...(await reverseGeocode(lat, lon)) };
    } catch (err) {
      console.warn('[whatsapp] reverse geocode failed', err.message);
    }
    return onPlace(phone, chat, place);
  }

  const choice =
    msg.type === 'interactive'
      ? msg.interactive?.button_reply?.id
      : msg.type === 'text'
        ? msg.text.body.trim()
        : null;
  if (choice == null) return sendText(phone, WELCOME);

  if (chat.step === 'confirm') {
    if (choice === 'send' || YES.test(choice)) return onSend(phone, chat);
    if (choice === 'cancel' || NO.test(choice)) {
      await clearChat(phone);
      return sendText(phone, 'Cancelled. Send a new photo whenever you spot a problem. 📷');
    }
    return askToSend(phone, chat.draft);
  }
  if (chat.step === 'support') {
    if (choice === 'support' || YES.test(choice)) return onSupport(phone, chat);
    if (choice === 'new' || NO.test(choice)) return askToSend(phone, chat.draft);
  }
  if (chat.step === 'location' && msg.type === 'text') {
    const place = await geocodeText(choice).catch(() => null);
    if (!place) {
      return sendText(phone, `😕 Couldn't find "${choice}" on the map. Try adding the area and city, e.g. "Kuvempunagar, Mysuru", or share your location with 📎.`);
    }
    return onPlace(phone, chat, place);
  }
  return sendText(phone, WELCOME);
}

/** Processes everything in one webhook delivery. Never throws: each failure gets an apology message. */
export async function handleUpdate(body) {
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const names = Object.fromEntries((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const msg of value.messages ?? []) {
        try {
          if (!(await firstTime(msg.id))) continue;
          await handleMessage(msg, names[msg.from] || '');
        } catch (err) {
          console.error('[whatsapp] message failed', err);
          await sendText(msg.from, '😕 Something went wrong on our side. Please send the photo again.').catch(() => {});
        }
      }
    }
  }
}

/** Meta signs every delivery with the app secret; anything else is rejected. */
function signedByMeta(rawBody, header) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // not set up yet (local testing)
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody ?? '', 'utf8').digest('hex')}`;
  const given = String(header ?? '');
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/**
 * GET  /api/whatsapp → Meta's one-time webhook check (echoes hub.challenge when the verify token matches).
 * POST /api/whatsapp → incoming messages; answered at once, processed in the background.
 */
export async function webhook({ method, query, headers, body, rawBody }) {
  if (method === 'GET') {
    const ok = query['hub.mode'] === 'subscribe' && query['hub.verify_token'] && query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN;
    return ok ? { text: query['hub.challenge'] ?? '' } : { status: 403, text: 'Forbidden' };
  }
  if (method !== 'POST') return { status: 405, json: { error: 'Use GET or POST.' } };
  if (!whatsappConfigured()) return { status: 501, json: { error: 'WhatsApp is not set up on the server.' } };
  if (!signedByMeta(rawBody, headers['x-hub-signature-256'])) return { status: 401, json: { error: 'Bad signature.' } };

  // Meta expects a quick 200; the photo analysis can take a while, so it continues after the reply.
  const work = handleUpdate(body);
  const { waitUntil } = await import('@vercel/functions');
  waitUntil(work);
  return { json: { received: true } };
}
webhook.rawBody = true;
