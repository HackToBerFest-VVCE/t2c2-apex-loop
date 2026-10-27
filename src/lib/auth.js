// Browser side of "Sign in with Google" and Gmail sending. The Google tokens never reach the
// browser: they live encrypted in an HttpOnly cookie that only the server (server/auth.js) can read.
// In the Android app, sign-in happens in Chrome and the app keeps the same encrypted session as a token.
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { API_BASE, apiFetch, isApp, setToken } from './api.js';

/** @returns {Promise<{ configured: boolean, signedIn: boolean, email?: string, name?: string, picture?: string }>} */
export async function getUser() {
  try {
    const res = await apiFetch('/api/auth/me');
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return { configured: false, signedIn: false };
  }
}

const VERIFIER_KEY = 'civiclens.signin-verifier';
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Website: full-page redirect to Google; comes back to `returnTo` (a path in this app) when done.
 * App: opens Google sign-in in Chrome with a one-time secret's hash; finishAppSignIn() completes it.
 */
export async function signIn(returnTo = '/') {
  if (!API_BASE) {
    window.location.href = `/api/auth/login?return=${encodeURIComponent(returnTo)}`;
    return;
  }
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  try {
    localStorage.setItem(VERIFIER_KEY, verifier);
  } catch {
    // Without storage the code can't be redeemed; sign-in will report that it failed.
  }
  const url = `${API_BASE}/api/auth/login?app=${challenge}`;
  if (isApp) await Browser.open({ url });
  else window.open(url, '_blank', 'noopener');
}

/**
 * App only: calls `onDone(message)` each time Chrome hands sign-in back through a civiclens://auth link.
 * `message` is null on success, or the reason it failed.
 */
export function listenForAppSignIn(onDone) {
  if (!isApp) return () => {};
  const handle = App.addListener('appUrlOpen', async ({ url }) => {
    if (!url.startsWith('civiclens://auth')) return;
    Browser.close().catch(() => {});
    const params = new URL(url.replace('civiclens://', 'https://app/')).searchParams;
    const code = params.get('code');
    let verifier = null;
    try {
      verifier = localStorage.getItem(VERIFIER_KEY);
      localStorage.removeItem(VERIFIER_KEY);
    } catch {
      verifier = null;
    }
    if (!code || !verifier) {
      onDone(AUTH_MESSAGES[params.get('error')] ?? AUTH_MESSAGES.failed);
      return;
    }
    try {
      const res = await apiFetch('/api/auth/app-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, verifier }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.token) throw new Error(data?.error);
      setToken(data.token);
      onDone(null);
    } catch (e) {
      onDone(e.message || AUTH_MESSAGES.failed);
    }
  });
  return () => handle.then((h) => h.remove());
}

export async function signOut() {
  await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  setToken(null);
}

/**
 * Sends the complaint from the signed-in Gmail with the photo attached.
 * Throws an Error with `.kind === 'signin'` when the user needs to sign in (again).
 */
export async function sendComplaint({ subject, body, photo, reportId }) {
  let res;
  try {
    res = await apiFetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body, photo, reportId }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error("Couldn't reach the CivicLens server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.sent) {
    if (data?.kind === 'signin') setToken(null); // the app's saved sign-in no longer works
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
