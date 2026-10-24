// Shared report log. Only complaints that were actually sent are recorded (drafts stay on the phone).
// Users never see each other's reports: the public actions below return only what the caller needs
// (a nearby match count, or statuses of their own report ids). The full list is admin-only.
import { db, dbConfigured } from './db.js';
import { gmailSend } from './gmail.js';
import { isAdmin, readSession } from './session.js';

const MAX_THUMB = 120_000; // thumbnails are ~15–40 KB as data URLs

/** Reports of the same kind of problem within this distance are treated as the same spot. */
const DEDUP_RADIUS_M = 15;
/** Extra tolerance for a fuzzy GPS fix, capped so two different potholes down the road aren't merged. */
const MAX_GPS_TOLERANCE_M = 15;
/** Support counts at which the authority gets one escalation email. */
const ESCALATION_AT = [3, 5, 10, 25, 50, 100, 250, 500];

const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const okThumb = (t) => (str(t, MAX_THUMB)?.startsWith('data:image/') ? t : null);

/** Closest open (sent, not yet fixed) complaint of the same department near a point, or null. */
async function findNearbyOpen(sql, { lat, lon, accuracy, department }) {
  const radius = DEDUP_RADIUS_M + Math.min(Math.max(accuracy ?? 0, 0), MAX_GPS_TOLERANCE_M);
  const dLat = radius / 111_320;
  const dLon = radius / (111_320 * Math.cos((lat * Math.PI) / 180));
  // Equirectangular distance is accurate to centimetres at this scale; the bounding box keeps it cheap.
  const [row] = await sql`
    SELECT * FROM (
      SELECT id, issue_type, severity, location, created_at, sent_at, supporters, reporter_email,
             6371000 * sqrt(power(radians(lat - ${lat}), 2) +
                            power(radians(lon - ${lon}) * cos(radians(${lat})), 2)) AS distance_m
      FROM reports
      WHERE status = 'Sent' AND department = ${department}
        AND lat BETWEEN ${lat - dLat} AND ${lat + dLat}
        AND lon BETWEEN ${lon - dLon} AND ${lon + dLon}
    ) nearby
    WHERE distance_m <= ${radius}
    ORDER BY distance_m
    LIMIT 1`;
  return row ?? null;
}

/**
 * POST /api/reports
 *   { action: 'sent', report }                → records a sent complaint (reporter taken from the sign-in, if any)
 *   { action: 'nearby', lat, lon, accuracy, department }
 *                                             → is this spot already reported? (count + date only, no personal data)
 *   { action: 'support', id, report }         → adds the caller's photo to an existing complaint (sign-in required);
 *                                               returns { escalate: true } when a milestone is reached
 *   { action: 'statuses', ids }               → current status of the caller's own report ids (e.g. "fixed")
 */
export async function reports({ method, body, cookies }) {
  if (method !== 'POST') return { status: 405, json: { error: 'Use POST.' } };
  if (!dbConfigured()) return { json: { stored: false, reason: 'no database configured' } };

  const sql = await db();
  const session = readSession(cookies);
  const action = body?.action;

  if (action === 'sent') {
    const r = body.report ?? {};
    const id = str(r.id, 64);
    if (!id || !str(r.issueType) || !str(r.severity) || !str(r.department)) {
      return { status: 400, json: { error: 'Incomplete report.' } };
    }
    await sql`
      INSERT INTO reports (id, created_at, reporter_email, reporter_name, issue_type, severity, department,
        authority, is_civic, description, description_kn, location, lat, lon, accuracy_m, coords_source, thumb, status, sent_at)
      VALUES (${id}, ${str(r.createdAt, 40) ?? new Date().toISOString()}, ${session?.email ?? null},
        ${session?.name ?? null}, ${str(r.issueType, 80)}, ${str(r.severity, 20)}, ${str(r.department, 40)},
        ${str(r.authority, 200)}, ${r.isCivicIssue !== false}, ${str(r.description)}, ${str(r.descriptionKn)},
        ${str(r.location, 400)}, ${num(r.coords?.lat)}, ${num(r.coords?.lon)}, ${num(r.coords?.accuracy)},
        ${str(r.coords?.source, 20)}, ${okThumb(r.thumb)}, 'Sent', now())
      ON CONFLICT (id) DO NOTHING`;
    return { json: { stored: true } };
  }

  if (action === 'nearby') {
    const lat = num(body.lat);
    const lon = num(body.lon);
    const department = str(body.department, 40);
    if (lat === null || lon === null || !department) return { json: { match: null } };
    const row = await findNearbyOpen(sql, { lat, lon, accuracy: num(body.accuracy), department });
    if (!row) return { json: { match: null } };
    let alreadySupported = false;
    if (session?.email) {
      if (row.reporter_email?.toLowerCase() === session.email.toLowerCase()) alreadySupported = true;
      else {
        const [mine] = await sql`
          SELECT 1 FROM report_supports WHERE report_id = ${row.id} AND lower(reporter_email) = lower(${session.email})`;
        alreadySupported = Boolean(mine);
      }
    }
    return {
      json: {
        match: {
          id: row.id,
          issueType: row.issue_type,
          severity: row.severity,
          location: row.location,
          firstReportedAt: row.sent_at ?? row.created_at,
          supporters: row.supporters,
          distanceM: Math.round(row.distance_m),
          alreadySupported,
        },
      },
    };
  }

  if (action === 'support') {
    if (!session) return { status: 401, json: { error: 'Please sign in with Google to add your support.', kind: 'signin' } };
    const id = str(body.id, 64);
    const r = body.report ?? {};
    const [target] = id ? await sql`SELECT id, status, reporter_email FROM reports WHERE id = ${id}` : [];
    if (!target || target.status !== 'Sent') {
      return { status: 404, json: { error: 'That complaint is no longer open.', kind: 'gone' } };
    }
    if (target.reporter_email?.toLowerCase() === session.email.toLowerCase()) {
      return { json: { already: true } };
    }
    const inserted = await sql`
      INSERT INTO report_supports (report_id, reporter_email, reporter_name, thumb, lat, lon, accuracy_m)
      VALUES (${id}, ${session.email}, ${session.name ?? null}, ${okThumb(r.thumb)},
              ${num(r.coords?.lat)}, ${num(r.coords?.lon)}, ${num(r.coords?.accuracy)})
      ON CONFLICT DO NOTHING
      RETURNING id`;
    if (!inserted.length) return { json: { already: true } };

    const [updated] = await sql`
      UPDATE reports SET supporters = supporters + 1 WHERE id = ${id}
      RETURNING supporters, issue_type, severity, location, lat, lon, authority, created_at, sent_at`;
    // Claim the milestone atomically so two people crossing it at once can't both trigger an email.
    let escalate = false;
    if (ESCALATION_AT.includes(updated.supporters)) {
      const claimed = await sql`
        UPDATE reports SET escalated_at = ${updated.supporters}
        WHERE id = ${id} AND escalated_at < ${updated.supporters} RETURNING id`;
      escalate = claimed.length > 0;
    }
    return {
      json: {
        supported: true,
        escalate,
        supporters: updated.supporters,
        report: {
          id,
          issueType: updated.issue_type,
          severity: updated.severity,
          location: updated.location,
          lat: updated.lat,
          lon: updated.lon,
          authority: updated.authority,
          firstReportedAt: updated.sent_at ?? updated.created_at,
        },
      },
    };
  }

  if (action === 'statuses') {
    const ids = Array.isArray(body.ids) ? body.ids.map((x) => str(x, 64)).filter(Boolean).slice(0, 200) : [];
    if (!ids.length) return { json: { statuses: {} } };
    const rows = await sql`SELECT id, status, resolved_at, supporters FROM reports WHERE id = ANY(${ids})`;
    const statuses = Object.fromEntries(
      rows.map((r) => [r.id, { status: r.status, resolvedAt: r.resolved_at, supporters: r.supporters }])
    );
    return { json: { statuses } };
  }

  return { status: 400, json: { error: 'Unknown action.' } };
}

/** Email everyone who reported or supported a complaint that it was fixed (Bcc, from the admin's Gmail). */
async function notifyFixed(sql, session, report) {
  const supporters = await sql`SELECT DISTINCT lower(reporter_email) AS email FROM report_supports
    WHERE report_id = ${report.id} AND reporter_email IS NOT NULL`;
  const emails = [...new Set([report.reporter_email?.toLowerCase(), ...supporters.map((s) => s.email)].filter(Boolean))];
  if (!emails.length) return { notified: 0 };

  const when = new Date(report.sent_at ?? report.created_at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const where = report.location ? ` at ${report.location}` : '';
  const map = report.lat != null ? `\nMap: https://maps.google.com/?q=${report.lat},${report.lon}\n` : '\n';
  const body = `Good news!

The ${report.issue_type.toLowerCase()}${where} that you reported on ${when} has been marked as fixed.
${map}
${emails.length > 1 ? `${emails.length} citizens reported or supported this complaint. ` : ''}Thank you for helping make our streets better.

ಶುಭ ಸುದ್ದಿ! ನೀವು ವರದಿ ಮಾಡಿದ ಸಮಸ್ಯೆಯನ್ನು ಸರಿಪಡಿಸಲಾಗಿದೆ. ನಿಮ್ಮ ಸಹಕಾರಕ್ಕೆ ಧನ್ಯವಾದಗಳು.

— CivicLens`;
  const result = await gmailSend(session, {
    to: session.email,
    bcc: emails,
    subject: `Fixed: ${report.issue_type}${where}`,
    body,
  });
  return result.ok ? { notified: emails.length } : { notified: 0, notifyError: result.error };
}

/**
 * GET  /api/admin/reports → every sent complaint plus totals.
 * POST /api/admin/reports
 *   { action: 'resolve', id } → marks it fixed and emails everyone who reported or supported it
 *   { action: 'reopen', id }  → undoes "fixed"
 *   { action: 'delete', id }  → removes it (e.g. spam or a test)
 * Admin Google accounts only.
 */
export async function adminReports({ method, body, cookies }) {
  if (method !== 'GET' && method !== 'POST') return { status: 405, json: { error: 'Use GET or POST.' } };
  const session = readSession(cookies);
  if (!session) return { status: 401, json: { error: 'Please sign in.' } };
  if (!isAdmin(session)) return { status: 403, json: { error: 'Not allowed.' } };
  if (!dbConfigured()) return { status: 501, json: { error: 'No database is connected yet.' } };

  const sql = await db();
  if (method === 'POST') {
    const id = str(body?.id, 64);
    if (!id) return { status: 400, json: { error: 'Missing report id.' } };

    if (body.action === 'delete') {
      await sql`DELETE FROM reports WHERE id = ${id}`;
      return { json: { deleted: true } };
    }
    if (body.action === 'reopen') {
      await sql`UPDATE reports SET status = 'Sent', resolved_at = NULL WHERE id = ${id}`;
      return { json: { reopened: true } };
    }
    if (body.action === 'resolve') {
      const [report] = await sql`
        UPDATE reports SET status = 'Resolved', resolved_at = now() WHERE id = ${id} AND status = 'Sent'
        RETURNING id, issue_type, location, lat, lon, reporter_email, created_at, sent_at`;
      if (!report) return { json: { resolved: false, error: 'Already fixed or not found.' } };
      const notice = await notifyFixed(sql, session, report).catch((err) => ({ notified: 0, notifyError: err.message }));
      return { json: { resolved: true, ...notice } };
    }
    return { status: 400, json: { error: 'Unknown action.' } };
  }

  const rows = await sql`
    SELECT id, created_at, reporter_email, reporter_name, issue_type, severity, department, authority,
           is_civic, description, location, lat, lon, accuracy_m, coords_source, thumb, status, sent_at,
           supporters, escalated_at, resolved_at
    FROM reports WHERE status <> 'Drafted' ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 500`;
  const [totals] = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE severity = 'high')::int AS high,
           count(*) FILTER (WHERE status = 'Resolved')::int AS resolved,
           COALESCE(sum(supporters), 0)::int AS citizens
    FROM reports WHERE status <> 'Drafted'`;
  return { json: { totals, reports: rows } };
}
