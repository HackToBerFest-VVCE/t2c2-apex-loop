// "Sign in with Google" using the server-side authorization-code flow. Google gives us a refresh
// token, which lives encrypted in the session cookie, so users stay signed in across refreshes
// and can send Gmail without popups.
import { randomBytes } from 'node:crypto';
import { clearCookie, cookie } from './http.js';
import { endSessionCookie, isAdmin, readSession, sessionCookie } from './session.js';

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

/** GET /api/auth/login?return=/path → Google's consent screen. */
export async function login({ query, origin }) {
  if (!authConfigured()) return { redirect: '/?auth=not-configured' };
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
    cookies: [cookie(STATE_COOKIE, JSON.stringify({ state, ret: safeReturn(query.return) }), { maxAge: 600 })],
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

  if (query.error) return done(`/?auth=${query.error === 'access_denied' ? 'denied' : 'failed'}`);
  if (!saved || !query.state || saved.state !== query.state || !query.code) return done('/?auth=failed');

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
    return done('/?auth=failed');
  }
  if (!String(tokens.scope ?? '').includes('gmail.send')) return done('/?auth=no-gmail');

  // The ID token came straight from Google over TLS, so its payload can be read without re-verifying.
  const profile = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
  const session = {
    refreshToken: tokens.refresh_token,
    email: profile.email,
    name: profile.name || profile.email,
    picture: profile.picture,
  };
  const ret = saved.ret || '/';
  return {
    redirect: `${ret}${ret.includes('?') ? '&' : '?'}auth=ok`,
    cookies: [clearCookie(STATE_COOKIE), sessionCookie(session)],
  };
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
