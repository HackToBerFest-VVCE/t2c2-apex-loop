// Where the CivicLens API lives and how to call it. The website calls its own /api with the sign-in
// cookie. The Android app (built with VITE_API_BASE, see .env.app) calls the live server instead and
// proves who is signed in with the session token it received at sign-in (server/http.js reads it).
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

/** True inside the installed Android app. */
export const isApp = Capacitor.isNativePlatform();

/** '' on the website (same origin); the live site's address in the app build. */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

const TOKEN_KEY = 'civiclens.token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: the user just has to sign in again next time.
  }
}

/** fetch() for our own API, from the website or the app. */
export function apiFetch(path, init = {}) {
  const headers = { ...init.headers };
  const token = API_BASE ? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_BASE}${path}`, { credentials: 'same-origin', ...init, headers });
}

/** Opens a web page outside the app (Chrome) in the app, or in a new tab on the website. */
export function openExternal(url) {
  if (isApp) Browser.open({ url });
  else window.open(url, '_blank', 'noopener');
}
