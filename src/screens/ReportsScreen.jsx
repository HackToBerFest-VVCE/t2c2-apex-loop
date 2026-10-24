import { DEPARTMENTS, STATUSES } from '../lib/constants.js';
import { SeverityBadge } from '../components/Badges.jsx';
import { ListIcon, TrashIcon } from '../components/Icons.jsx';

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function ReportsScreen({ reports, onOpen, onStatus, onDelete, onGoReport }) {
  return (
    <div className="screen">
      <header className="screen-head">
        <p className="eyebrow">My reports</p>
        <h1>Your reports</h1>
        <p className="lede">
          {reports.length
            ? `${reports.length} issue${reports.length === 1 ? '' : 's'} reported. Tap one to view its complaint.`
            : 'Issues you report will show up here.'}
        </p>
      </header>

      {reports.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <ListIcon width={26} height={26} />
          </div>
          <h2>Nothing reported yet</h2>
          <p>Your first report takes about thirty seconds.</p>
          <button className="btn btn-primary" onClick={onGoReport}>
            Report an issue
          </button>
        </div>
      ) : (
        <ul className="report-list">
          {reports.map((r) => (
            <li key={r.id} className="card report-item">
              <button className="report-main" onClick={() => onOpen(r.id)}>
                <img src={r.thumb} alt="" className="report-thumb" />
                <div className="report-info">
                  <strong>{r.issueType}</strong>
                  <span className="muted report-sub">
                    {r.location || DEPARTMENTS[r.department].label} · {timeAgo(r.createdAt)}
                  </span>
                  <SeverityBadge severity={r.severity} />
                </div>
              </button>
              <div className="report-side">
                <select
                  className={`status-select status-${r.status.toLowerCase()}`}
                  value={r.status}
                  onChange={(e) => onStatus(r.id, e.target.value)}
                  aria-label="Status"
                >
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <button
                  className="icon-btn subtle"
                  aria-label="Delete report"
                  onClick={() => confirm('Delete this report?') && onDelete(r.id)}
                >
                  <TrashIcon width={17} height={17} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
