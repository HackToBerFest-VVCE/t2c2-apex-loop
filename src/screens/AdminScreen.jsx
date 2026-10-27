import { useEffect, useState } from 'react';
import { adminAction, fetchAllReports, useMyGmailForBot } from '../lib/reportsApi.js';
import { SeverityBadge, StatusBadge } from '../components/Badges.jsx';
import { AlertIcon, ListIcon, PinIcon, TrashIcon } from '../components/Icons.jsx';

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const FILTERS = [
  { id: 'open', label: 'Open', test: (r) => r.status === 'Sent' },
  { id: 'top', label: 'Most reported', test: (r) => r.supporters > 1, sort: (a, b) => b.supporters - a.supporters },
  { id: 'fixed', label: 'Fixed', test: (r) => r.status === 'Resolved' },
  { id: 'all', label: 'All', test: () => true },
];

/** Every report from every user. Only rendered for admins, and the server re-checks on every request. */
export default function AdminScreen() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open');
  const [info, setInfo] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(await fetchAllReports());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function act(r, action) {
    setBusyId(r.id);
    setError('');
    setInfo('');
    try {
      const res = await adminAction(r.id, action);
      if (action === 'resolve') {
        setInfo(
          res.notifyError
            ? `Marked as fixed, but the email to reporters failed: ${res.notifyError}`
            : res.notified
              ? `Marked as fixed. ${res.notified} ${res.notified === 1 ? 'person was' : 'people were'} emailed.`
              : "Marked as fixed. Nobody to email (the reporter wasn't signed in)."
        );
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function setBotSender() {
    setError('');
    try {
      const res = await useMyGmailForBot();
      setInfo(`The WhatsApp bot now sends complaints from ${res.botSender}.`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  function markFixed(r) {
    if (!window.confirm(`Mark this ${r.issue_type.toLowerCase()} as fixed? Everyone who reported it gets an email from your Gmail.`)) return;
    act(r, 'resolve');
  }

  function remove(r) {
    if (!window.confirm(`Delete this ${r.issue_type.toLowerCase()} report for everyone? This can't be undone.`)) return;
    act(r, 'delete');
  }

  const current = FILTERS.find((f) => f.id === filter);
  const list = (data?.reports ?? []).filter(current.test);
  if (current.sort) list.sort(current.sort);
  const t = data?.totals;

  return (
    <div className="screen">
      <header className="screen-head admin-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>All reports</h1>
          <p className="lede">Every complaint users have sent. Only you can see this page. Mark one as fixed to let everyone who reported it know.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {error && (
        <div className="alert" role="alert">
          <AlertIcon width={18} height={18} />
          <span>{error}</span>
        </div>
      )}

      {info && (
        <div className="alert notice" role="status">
          <span>{info}</span>
          <button className="notice-close" onClick={() => setInfo('')} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {t && (
        <div className="stats admin-stats">
          <div className="card stat">
            <span className="stat-label">Complaints</span>
            <span className="stat-value">{t.total}</span>
          </div>
          <div className="card stat">
            <span className="stat-label">High severity</span>
            <span className="stat-value">{t.high}</span>
          </div>
          <div className="card stat">
            <span className="stat-label">Fixed</span>
            <span className="stat-value">{t.resolved}</span>
          </div>
          <div className="card stat">
            <span className="stat-label">Citizens</span>
            <span className="stat-value">{t.citizens}</span>
          </div>
        </div>
      )}

      {data?.whatsapp && (
        <div className="card admin-bot">
          <p className="admin-bot-text">
            <strong>WhatsApp bot</strong>
            <span className="muted">
              {data.botSender ? ` sends complaints from ${data.botSender}` : ' can’t send yet: choose the Gmail it sends from'}
            </span>
          </p>
          <button className="btn btn-secondary btn-sm" onClick={setBotSender}>
            {data.botSender ? 'Use my Gmail instead' : 'Use my Gmail'}
          </button>
        </div>
      )}

      {data && (
        <div className="seg admin-filter" role="tablist" aria-label="Filter reports">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              className={filter === f.id ? 'is-on' : ''}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {data && list.length === 0 && (
        <div className="empty">
          <div className="empty-icon">
            <ListIcon width={26} height={26} />
          </div>
          <h2>No reports here yet</h2>
          <p>Complaints appear here as soon as someone sends one.</p>
        </div>
      )}

      <ul className="report-list">
        {list.map((r) => (
          <li key={r.id} className="card admin-item">
            {r.thumb ? <img src={r.thumb} alt="" className="report-thumb" /> : <div className="report-thumb" />}
            <div className="admin-info">
              <div className="admin-top">
                <strong>{r.issue_type}</strong>
                <StatusBadge status={r.status} />
              </div>
              <div className="admin-meta">
                <SeverityBadge severity={r.severity} />
                <span className="muted">{r.authority || r.department}</span>
              </div>
              {(r.location || r.lat != null) && (
                <p className="admin-line">
                  <PinIcon width={14} height={14} />
                  {r.lat != null ? (
                    <a href={`https://maps.google.com/?q=${r.lat},${r.lon}`} target="_blank" rel="noreferrer">
                      {r.location || `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}`}
                    </a>
                  ) : (
                    <span>{r.location}</span>
                  )}
                </p>
              )}
              <div className="admin-who">
                <p>
                  <span className="admin-name">{r.reporter_name || r.reporter_email || r.reporter_phone || 'Not signed in'}</span>
                  <span className="admin-time"> · {timeAgo(r.created_at)}</span>
                </p>
                {r.reporter_name && r.reporter_email && <p className="admin-email">{r.reporter_email}</p>}
                {r.reporter_phone && <p className="admin-email">WhatsApp {r.reporter_phone}</p>}
              </div>
              {!r.is_civic && <p className="admin-line admin-flag">AI flagged: may not be a civic issue</p>}
              {r.supporters > 1 && (
                <p className="admin-line admin-crowd">
                  {r.supporters} people reported this spot
                  {r.escalated_at > 1 && <span className="admin-escalated"> · escalated at {r.escalated_at}</span>}
                </p>
              )}
              <div className="admin-actions">
                {r.status === 'Resolved' ? (
                  <>
                    <span className="admin-fixed">
                      Fixed{r.resolved_at ? ` · ${new Date(r.resolved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
                    </span>
                    <button className="link-btn" onClick={() => act(r, 'reopen')} disabled={busyId === r.id}>
                      Reopen
                    </button>
                  </>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => markFixed(r)} disabled={busyId === r.id}>
                    {busyId === r.id ? 'Saving…' : 'Mark as fixed'}
                  </button>
                )}
              </div>
            </div>
            <button className="icon-btn subtle admin-delete" onClick={() => remove(r)} aria-label="Delete report">
              <TrashIcon width={18} height={18} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
