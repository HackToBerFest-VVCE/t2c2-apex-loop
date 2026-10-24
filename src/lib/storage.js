const REPORTS_KEY = 'civiclens.reports';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadReports = () => read(REPORTS_KEY, []);

/** Saves reports, dropping the oldest ones if the browser storage quota is hit. */
export function saveReports(reports) {
  let list = reports;
  while (!write(REPORTS_KEY, list) && list.length > 1) list = list.slice(0, -1);
  return list;
}

