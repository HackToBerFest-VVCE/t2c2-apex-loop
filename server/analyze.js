// Server-side photo analysis. Runs as a Vercel function in production (api/analyze.js) and as
// Vite dev-server middleware locally (vite.config.js), so API keys never reach the browser.
import { GoogleGenAI } from '@google/genai';
import { ISSUE_TYPES } from '../src/lib/constants.js';

/** Groq vision model; override with GROQ_VISION_MODEL if Groq renames or retires it. */
const GROQ_MODEL = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b';

/**
 * Tried in order until one answers. Groq is a different provider, so it keeps working when
 * Google's models are overloaded. A provider is skipped when its API key isn't set.
 */
const ATTEMPTS = [
  { provider: 'gemini', model: 'gemini-3.5-flash' },
  { provider: 'groq', model: GROQ_MODEL },
  { provider: 'gemini', model: 'gemini-3.8-flash' },
  { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
];

/** Seconds to wait for one model before trying the next. */
const ATTEMPT_TIMEOUT = 18;
/** Stop starting new attempts after this long, so the whole request fits in the function's time limit. */
const TOTAL_BUDGET = 52;

const PROMPT = `You are a civic infrastructure inspector in Karnataka, India.
Look at the attached photo and assess the civic problem it shows.

Respond with ONLY a single JSON object — no markdown, no code fences, no extra text — with exactly these fields:
{
  "isCivicIssue": boolean,       // false if the photo does not show a civic/public infrastructure problem
  "issueType": string,           // one of: ${ISSUE_TYPES.map((t) => `"${t}"`).join(', ')}
  "severity": string,            // one of: "low", "medium", "high"
  "department": string,          // one of: "Roads", "Electrical", "Waste", "Water"
  "description": string,         // 1–2 short factual sentences (under 40 words) in English: what is visible and the risk to the public
  "descriptionKn": string        // the same description in natural, formal Kannada, equally concise
}

Severity guide: "high" = immediate safety hazard (deep pothole on a busy road, exposed live wires, major leak, large garbage pile blocking the road);
"medium" = clear nuisance that will worsen; "low" = minor or cosmetic.`;

const MAX_IMAGE_BASE64 = 4_000_000; // ~3 MB image; the app sends ~200–500 KB

/** Pulls the first JSON object out of a model response, tolerating code fences or stray text. */
function extractJson(text) {
  if (!text) throw new Error('empty response');
  // Reasoning models (e.g. Qwen) may put their thinking in <think> tags before the answer.
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON in response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

let gemini;

async function askGemini(model, image, mimeType, signal) {
  gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await gemini.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: image } }, { text: PROMPT }] }],
    config: { temperature: 0.2, abortSignal: signal },
  });
  return response.text;
}

async function askGroq(model, image, mimeType, signal) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image}` } },
          ],
        },
      ],
    }),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // On 429 Groq says how long until the per-minute limit frees up ("try again in 13.49s").
    const wait = Number(res.headers.get('retry-after')) || Number(detail.match(/try again in ([\d.]+)s/)?.[1]);
    throw Object.assign(new Error(detail.slice(0, 200)), { status: res.status, retryAfter: wait || null });
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

const ASK = { gemini: askGemini, groq: askGroq };
const KEY_FOR = { gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY' };

function describeFailure(err) {
  if (err?.timedOut) return `no reply after ${ATTEMPT_TIMEOUT}s`;
  if (err?.status) return `HTTP ${err.status}`;
  return err?.message ?? 'unknown error';
}

const isAuthError = (err) => err?.status === 401 || err?.status === 403;

/**
 * @param {{ image?: string, mimeType?: string }} body - base64 image without the data: prefix
 * @returns {Promise<{ status: number, json: object }>}
 */
export async function handleAnalyze(body) {
  const attempts = ATTEMPTS.filter((a) => process.env[KEY_FOR[a.provider]]);
  if (!attempts.length) {
    return { status: 500, json: { error: 'The server has no AI API key configured.', kind: 'config' } };
  }
  const { image, mimeType = 'image/jpeg' } = body ?? {};
  if (typeof image !== 'string' || !image || image.length > MAX_IMAGE_BASE64 || !/^image\//.test(mimeType)) {
    return { status: 400, json: { error: 'Please send a photo (JPEG or PNG, under 3 MB).', kind: 'bad_request' } };
  }

  const startedAt = Date.now();
  const elapsed = () => (Date.now() - startedAt) / 1000;
  const failures = [];
  let retryLater = null; // { provider, model, at } when a model said "busy, try again in a few seconds"

  async function attempt(provider, model) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT * 1000);
    try {
      const text = await ASK[provider](model, image, mimeType, controller.signal);
      return { status: 200, json: { result: extractJson(text), model } };
    } catch (err) {
      // Any failure (overload, timeout, bad key, unreadable reply) moves on to the next model.
      const e = controller.signal.aborted ? { timedOut: true } : err;
      failures.push({ label: `${provider}/${model}`, err: e });
      if (e?.status === 429 && e.retryAfter && e.retryAfter <= 20 && !retryLater) {
        retryLater = { provider, model, at: Date.now() + e.retryAfter * 1000 };
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  for (const { provider, model } of attempts) {
    if (elapsed() > TOTAL_BUDGET - ATTEMPT_TIMEOUT) break;
    const ok = await attempt(provider, model);
    if (ok) return ok;
  }

  // A rate-limited model that frees up within a few seconds gets one more go, if time allows.
  if (retryLater) {
    const waitMs = Math.max(0, retryLater.at - Date.now());
    if (elapsed() + waitMs / 1000 + ATTEMPT_TIMEOUT <= TOTAL_BUDGET) {
      await new Promise((r) => setTimeout(r, waitMs));
      const ok = await attempt(retryLater.provider, retryLater.model);
      if (ok) return ok;
    }
  }

  const summary = failures.map(({ label, err }) => `${label}: ${describeFailure(err)}`).join('; ');
  console.warn(`[analyze] all models failed — ${summary}`);
  if (failures.length && failures.every(({ err }) => isAuthError(err))) {
    return { status: 502, json: { error: 'The AI service rejected the request. Check the server API keys.', kind: 'config' } };
  }
  return { status: 503, json: { error: 'The AI service is busy right now. Please try again in a minute.', kind: 'busy' } };
}
