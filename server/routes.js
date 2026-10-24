// Every API endpoint, by path. Vercel uses the matching file in api/; the Vite dev server uses this map.
import { handleAnalyze } from './analyze.js';
import { callback, login, logout, me } from './auth.js';
import { send } from './send.js';
import { adminReports, reports } from './reports.js';

async function analyze({ method, body }) {
  if (method !== 'POST') return { status: 405, json: { error: 'Use POST.' } };
  return handleAnalyze(body);
}

export const ROUTES = {
  '/api/analyze': analyze,
  '/api/send': send,
  '/api/reports': reports,
  '/api/admin/reports': adminReports,
  '/api/auth/login': login,
  '/api/auth/callback': callback,
  '/api/auth/me': me,
  '/api/auth/logout': logout,
};
