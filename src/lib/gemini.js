// Browser side of photo analysis: sends the photo to our own /api/analyze endpoint
// (server/analyze.js), which holds the API keys and talks to the AI models.
import { apiFetch } from './api.js';
import { normalize } from './normalize.js';

/** Whole-request limit; the server tries several models within ~50 s. */
const REQUEST_TIMEOUT_MS = 65_000;

/**
 * Analyses a photo and returns a normalized assessment.
 * @param {string} base64 - image data without the data: URL prefix
 * @param {string} mimeType
 * @param {(detail: string) => void} [onProgress] - receives a line describing what's happening
 */
export async function analyzeIssue(base64, mimeType, onProgress = () => {}) {
  onProgress('AI is analysing your photo');
  let res;
  try {
    res = await apiFetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, mimeType }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(
      e?.name === 'TimeoutError'
        ? 'The analysis took too long. Please try again.'
        : "Couldn't reach the CivicLens server. Check your internet connection and try again."
    );
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.result) {
    if (data?.kind === 'config') console.error('[CivicLens] server configuration problem:', data.error);
    throw new Error(data?.error ?? 'Something went wrong while analysing the photo.');
  }
  return { ...normalize(data.result), model: data.model };
}
