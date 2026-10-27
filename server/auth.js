// "Sign in with Google" using the server-side authorization-code flow. Google gives us a refresh
// token, which lives encrypted in the session cookie, so users stay signed in across refreshes
// and can send Gmail without popups.
import { createHash, randomBytes } from 'node:crypto';
import { clearCookie, cookie } from './http.js';
import { endSessionCookie, isAdmin, readSession, seal, sessionCookie, unseal } from './session.js';

const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.send'];
const STATE_COOKIE = 'cl_oauth_state';

const clientId = () => process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET;

/** True when everything needed for Google sign-in is set on the server. */
export const authConfigured = () =>
  Boolean(clientId() && clientSecret() && (process.env.SESSION_SECRET?.length ?? 0) >= 32);

const redirectUri = (origin) => `${origin}/api/auth/callback`;

/** Only same-site paths are allowed as a post-login destination. */
const safeReturn = (value) => (typeof value === 'string' && /^\/(?!\/)/.test(value) ? value : '/');

/** PKCE-style challenge from the Android app: base64url SHA-256 of a secret the app keeps. */
const isChallenge = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
const sha256url = (text) => createHash('sha256').update(text).digest('base64url');

/**
 * GET /api/auth/login?return=/path → Google's consent screen.
 * GET /api/auth/login?app=<challenge> → same, started from the Android app in Chrome; ends at /app-return.html.
 */
export async function login({ query, origin }) {
  const app = isChallenge(query.app) ? query.app : null;
  if (!authConfigured()) return { redirect: app ? '/app-return.html#error=not-configured' : '/?auth=not-configured' };
  const state = randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline', // ask for a refresh token
    prompt: 'consent', // Google only returns a refresh token when consent is shown
    include_granted_scopes: 'true',
    state,
  });
  return {
    redirect: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    // Remember the CSRF state and where to go afterwards for 10 minutes.
    cookies: [cookie(STATE_COOKIE, JSON.stringify({ state, ret: safeReturn(query.return), app }), { maxAge: 600 })],
  };
}

/** GET /api/auth/callback?code=…&state=… — Google sends the user back here. */
export async function callback({ query, cookies, origin }) {
  let saved = null;
  try {
    saved = JSON.parse(cookies[STATE_COOKIE] ?? 'null');
  } catch {
    saved = null;
  }
  const done = (path) => ({ redirect: path, cookies: [clearCookie(STATE_COOKIE)] });
  // App sign-ins report back to the page that hands control to the app; web sign-ins to the site.
  const fail = (reason) => done(saved?.app ? `/app-return.html#error=${reason}` : `/?auth=${reason}`);

  if (query.error) return fail(query.error === 'access_denied' ? 'denied' : 'failed');
  if (!saved || !query.state || saved.state !== query.state || !query.code) return fail('failed');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: query.code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(origin),
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await res.json().catch(() => ({}));
  if (!res.ok || !tokens.refresh_token || !tokens.id_token) {
    console.error('[auth] token exchange failed', res.status, tokens.error, tokens.error_description);
    return fail('failed');
  }
  if (!String(tokens.scope ?? '').includes('gmail.send')) return fail('no-gmail');

  // The ID token came straight from Google over TLS, so its payload can be read without re-verifying.
  const profile = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
  const session = {
    refreshToken: tokens.refresh_token,
    email: profile.email,
    name: profile.name || profile.email,
    picture: profile.picture,
  };
  if (saved.app) {
    // A short-lived, encrypted one-time code. Only the app that started sign-in knows the secret behind
    // the challenge, so another app catching the civiclens:// link can't swap it for the session.
    const code = seal({ session, challenge: saved.app, exp: Date.now() + APP_CODE_TTL_MS });
    return done(`/app-return.html#code=${code}`);
  }
  const ret = saved.ret || '/';
  return {
    redirect: `${ret}${ret.includes('?') ? '&' : '?'}auth=ok`,
    cookies: [clearCookie(STATE_COOKIE), sessionCookie(session)],
  };
}

const APP_CODE_TTL_MS = 5 * 60 * 1000;

/** POST /api/auth/app-token { code, verifier } → { token }: the app's sealed session, sent later as a Bearer token. */
export async function appToken({ method, body }) {
  if (method !== 'POST') return { status: 405, json: { error: 'Use POST.' } };
  const data = typeof body?.code === 'string' ? unseal(body.code) : null;
  const verifier = typeof body?.verifier === 'string' ? body.verifier : '';
  if (!data?.session || !data.challenge || Date.now() > data.exp || sha256url(verifier) !== data.challenge) {
    return { status: 400, json: { error: 'Sign-in expired. Please try again.' } };
  }
  return { json: { token: seal(data.session) } };
}

/** GET /api/auth/me → who is signed in (never exposes the token). */
export async function me({ cookies }) {
  if (!authConfigured()) return { json: { configured: false, signedIn: false } };
  const s = readSession(cookies);
  if (!s) return { json: { configured: true, signedIn: false } };
  return {
    json: { configured: true, signedIn: true, email: s.email, name: s.name, picture: s.picture, isAdmin: isAdmin(s) },
  };
}

/** POST /api/auth/logout → forget the session and revoke Google's permission. */
export async function logout({ method, cookies }) {
  if (method !== 'POST') return { status: 405, json: { error: 'Use POST.' } };
  const s = readSession(cookies);
  if (s?.refreshToken) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(s.refreshToken)}`, {
      method: 'POST',
    }).catch(() => {});
  }
  return { json: { signedIn: false }, cookies: [endSessionCookie()] };
}

/** Swaps the stored refresh token for a short-lived access token. Throws { signin: true } if it no longer works. */
export async function accessTokenFor(session) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: session.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    // invalid_grant = expired (7 days in Testing mode) or revoked by the user.
    throw Object.assign(new Error(data.error || `token refresh failed (${res.status})`), {
      signin: data.error === 'invalid_grant',
      config: data.error === 'invalid_client' || data.error === 'unauthorized_client',
    });
  }
  return data.access_token;
}
