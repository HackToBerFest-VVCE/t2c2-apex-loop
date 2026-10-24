import { DEPARTMENTS, ISSUE_TYPES, SEVERITIES, SEVERITY_LABEL } from '../lib/constants.js';
import { ChartIcon } from '../components/Icons.jsx';

function countBy(reports, key, keys) {
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  reports.forEach((r) => (counts[r[key]] = (counts[r[key]] ?? 0) + 1));
  return counts;
}

function BarList({ rows, total, colorFor }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="bars">
      {rows.map((row) => {
        const pct = total ? Math.round((row.value / total) * 100) : 0;
        return (
          <li key={row.label} className="bar-row" title={`${row.label}: ${row.value} (${pct}%)`}>
            <div className="bar-labels">
              <span>{row.label}</span>
              <span className="bar-value">
                {row.value}
                <span className="muted"> · {pct}%</span>
              </span>
            </div>
            <div className="bar-track">
              <div
                className={`bar-fill ${colorFor ? colorFor(row) : ''}`}
                style={{ width: row.value ? `${Math.max(3, (row.value / max) * 100)}%` : 0 }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function HotspotScreen({ reports, onGoReport }) {
  const total = reports.length;
  const bySeverity = countBy(reports, 'severity', SEVERITIES);
  const byType = countBy(reports, 'issueType', ISSUE_TYPES);
  const byDept = countBy(reports, 'department', Object.keys(DEPARTMENTS));
  const resolved = reports.filter((r) => r.status === 'Resolved').length;

  const typeRows = ISSUE_TYPES.map((t) => ({ label: t, value: byType[t] }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const severityRows = [...SEVERITIES].reverse().map((s) => ({ key: s, label: SEVERITY_LABEL[s], value: bySeverity[s] }));
  const deptRows = Object.keys(DEPARTMENTS).map((d) => ({ label: DEPARTMENTS[d].label, value: byDept[d] }));

  return (
    <div className="screen">
      <header className="screen-head">
        <p className="eyebrow">Hotspots</p>
        <h1>Issue overview</h1>
        <p className="lede">A summary of everything you’ve reported, by type and severity.</p>
      </header>

      {total === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <ChartIcon width={26} height={26} />
          </div>
          <h2>No data yet</h2>
          <p>Once you report issues, you’ll see where problems cluster.</p>
          <button className="btn btn-primary" onClick={onGoReport}>
            Report an issue
          </button>
        </div>
      ) : (
        <>
          <div className="stats">
            <div className="card stat">
              <span className="stat-label">Total reports</span>
              <span className="stat-value">{total}</span>
            </div>
            <div className="card stat">
              <span className="stat-label">High severity</span>
              <span className="stat-value">{bySeverity.high}</span>
            </div>
            <div className="card stat">
              <span className="stat-label">Resolved</span>
              <span className="stat-value">{resolved}</span>
            </div>
          </div>

          <section className="card chart-card">
            <h3>By issue type</h3>
            <BarList rows={typeRows} total={total} />
          </section>

          <section className="card chart-card">
            <h3>By severity</h3>
            <BarList rows={severityRows} total={total} colorFor={(row) => `sev-fill-${row.key}`} />
          </section>

          <section className="card chart-card">
            <h3>By department</h3>
            <BarList rows={deptRows} total={total} />
          </section>
        </>
      )}
    </div>
  );
}
