import { SEVERITY_LABEL } from '../lib/constants.js';

export function SeverityBadge({ severity }) {
  return (
    <span className={`badge sev-${severity}`}>
      <span className="dot" />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function StatusBadge({ status }) {
  return <span className={`badge status-${status.toLowerCase()}`}>{status}</span>;
}
