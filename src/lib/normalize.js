// Cleans up an AI model's answer into our fixed labels. Shared by the app (gemini.js) and the
// WhatsApp bot on the server, so it must not import anything browser- or app-only.
import { DEPARTMENTS, ISSUE_TYPES, ISSUE_TYPES_KN, SEVERITIES } from './constants.js';

function pick(value, options, fallback) {
  const v = String(value ?? '').trim().toLowerCase();
  return options.find((o) => o.toLowerCase() === v) ?? options.find((o) => v.includes(o.toLowerCase())) ?? fallback;
}

const MANHOLE = 'Open / damaged manhole';

export function normalize(raw) {
  // Models sometimes shorten the label ("Open manhole"), so match on the key word.
  const issueType = /manhole/i.test(String(raw.issueType ?? '')) ? MANHOLE : pick(raw.issueType, ISSUE_TYPES, 'Other');
  const isManhole = issueType === MANHOLE;
  return {
    isCivicIssue: raw.isCivicIssue !== false,
    issueType,
    issueTypeKn: ISSUE_TYPES_KN[issueType],
    // A damaged manhole can kill someone, so it is always urgent and goes to the drainage authority.
    severity: isManhole ? 'high' : pick(raw.severity, SEVERITIES, 'medium'),
    department: isManhole ? 'Water' : pick(raw.department, Object.keys(DEPARTMENTS), 'Roads'),
    description: String(raw.description ?? '').trim(),
    descriptionKn: String(raw.descriptionKn ?? '').trim(),
  };
}
