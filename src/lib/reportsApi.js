// Records sent complaints in the shared server-side log (server/reports.js) so the admin can see them.
// Drafts are never uploaded: a report only reaches the log once its complaint has been sent.
// Best-effort: the app works fully offline-first, so a failure here is only logged.
import { authorityFor } from './authorities.js';
import { apiFetch } from './api.js';

async function post(payload) {
  try {
    const res = await apiFetch('/api/reports', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.warn('[CivicLens] report log failed', res.status);
  } catch (err) {
    console.warn('[CivicLens] report log failed', err);
  }
}

export function logSent(report) {
  const { id, createdAt, issueType, severity, department, isCivicIssue, description, descriptionKn, location, coords, thumb } =
    report;
  return post({
    action: 'sent',
    report: {
      id,
      createdAt,
      issueType,
      severity,
      department,
      isCivicIssue,
      description,
      descriptionKn,
      location,
      coords,
      thumb,
      authority: authorityFor(report).name,
    },
  });
}

async function call(payload) {
  const res = await apiFetch('/api/reports', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `Request failed (${res.status}).`), { kind: data?.kind });
  return data;
}

/** Is this spot already reported (same kind of problem, within ~15 m, not yet fixed)? Never throws. */
export async function checkNearby(report) {
  if (!report.coords) return null;
  try {
    const { lat, lon, accuracy } = report.coords;
    const data = await call({ action: 'nearby', lat, lon, accuracy, department: report.department });
    return data?.match ?? null;
  } catch {
    return null;
  }
}

/** Adds this user's photo to an existing complaint. Returns { supported | already, escalate, supporters, report }. */
export const addSupport = (matchId, report) =>
  call({ action: 'support', id: matchId, report: { thumb: report.thumb, coords: report.coords } });

/** Server-side status of the user's own complaints, by id (to spot ones the authority has fixed). */
export async function fetchStatuses(ids) {
  if (!ids.length) return {};
  try {
    return (await call({ action: 'statuses', ids }))?.statuses ?? {};
  } catch {
    return {};
  }
}

/** Admin only — 'resolve' (mark fixed + notify reporters), 'reopen' or 'delete'. The server refuses everyone else. */
export async function adminAction(id, action) {
  const res = await apiFetch('/api/admin/reports', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? 'That action failed.');
  return data;
}

/** Admin only — the WhatsApp bot sends complaints from this admin's Gmail from now on. */
export async function useMyGmailForBot() {
  const res = await apiFetch('/api/admin/reports', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'bot-sender' }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? 'That action failed.');
  return data;
}

/** Admin only — the server refuses everyone else. */
export async function fetchAllReports() {
  const res = await apiFetch('/api/admin/reports', { credentials: 'same-origin' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Could not load reports (${res.status}).`);
  return data;
}
