// Browser side of "Sign in with Google" and Gmail sending. The Google tokens never reach the
// browser: they live encrypted in an HttpOnly cookie that only the server (server/auth.js) can read.

/** @returns {Promise<{ configured: boolean, signedIn: boolean, email?: string, name?: string, picture?: string }>} */
export async function getUser() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return { configured: false, signedIn: false };
  }
}

/** Full-page redirect to Google; comes back to `returnTo` (a path in this app) when done. */
export function signIn(returnTo = '/') {
  window.location.href = `/api/auth/login?return=${encodeURIComponent(returnTo)}`;
}

export async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
}

/**
 * Sends the complaint from the signed-in Gmail with the photo attached.
 * Throws an Error with `.kind === 'signin'` when the user needs to sign in (again).
 */
export async function sendComplaint({ subject, body, photo, reportId }) {
  let res;
  try {
    res = await fetch('/api/send', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body, photo, reportId }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error("Couldn't reach the CivicLens server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.sent) {
    throw Object.assign(new Error(data?.error ?? 'Sending failed. Please try again.'), { kind: data?.kind });
  }
  return data;
}

/** Messages for the ?auth=… result Google sign-in returns with. */
export const AUTH_MESSAGES = {
  ok: null,
  denied: 'Sign-in was cancelled.',
  failed: "Google sign-in didn't complete. Please try again.",
  'no-gmail': 'Please allow "Send email on your behalf" so CivicLens can send your complaint.',
  'not-configured': 'Google sign-in is not set up on this server yet.',
};
