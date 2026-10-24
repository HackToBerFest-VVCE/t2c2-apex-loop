import { useEffect, useState } from 'react';
import ReportScreen from './screens/ReportScreen.jsx';
import ComplaintScreen from './screens/ComplaintScreen.jsx';
import ReportsScreen from './screens/ReportsScreen.jsx';
import HotspotScreen from './screens/HotspotScreen.jsx';
import Landing from './screens/Landing.jsx';
import AdminScreen from './screens/AdminScreen.jsx';
import { CameraIcon, ChartIcon, DocIcon, ListIcon, PinIcon } from './components/Icons.jsx';
import { fetchStatuses, logSent } from './lib/reportsApi.js';
import { loadReports, saveReports } from './lib/storage.js';
import { deletePhoto } from './lib/photos.js';
import { AUTH_MESSAGES, getUser, signIn, signOut } from './lib/auth.js';
import AccountButton from './components/AccountButton.jsx';

const TABS = [
  { id: 'report', label: 'Report', Icon: CameraIcon },
  { id: 'complaint', label: 'Complaint', Icon: DocIcon },
  { id: 'reports', label: 'My Reports', Icon: ListIcon },
  { id: 'hotspots', label: 'Hotspots', Icon: ChartIcon },
];
// Only shown to admin accounts (and the server checks again before returning any data).
const ADMIN_TAB = { id: 'admin', label: 'All reports', Icon: PinIcon };

/** After Google sign-in we come back to /?view=…&report=…&auth=…; read that once, then tidy the URL. */
function readReturnUrl() {
  const params = new URLSearchParams(window.location.search);
  const result = {
    view: [...TABS, ADMIN_TAB].some((t) => t.id === params.get('view')) ? params.get('view') : null,
    reportId: params.get('report'),
    auth: params.get('auth'),
  };
  if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  return result;
}

export default function App() {
  const [returned] = useState(readReturnUrl);
  // The landing page shows once per visit (per browser tab), but not when coming back from sign-in.
  const [entered, setEntered] = useState(() => {
    if (returned.view || returned.auth) return true;
    try {
      return sessionStorage.getItem('civiclens.entered') === '1';
    } catch {
      return false;
    }
  });
  const [view, setView] = useState(returned.view ?? 'report');
  const [reports, setReports] = useState(loadReports);
  const [activeId, setActiveId] = useState(returned.reportId);
  const [user, setUser] = useState({ configured: false, signedIn: false, loading: true });
  const [notice, setNotice] = useState(AUTH_MESSAGES[returned.auth] ?? null);

  useEffect(() => {
    getUser().then(setUser);
  }, []);

  // Has the authority fixed any complaint this user sent or supported? Check once when the app opens.
  useEffect(() => {
    const open = reports.filter((r) => r.status === 'Sent');
    const idFor = (r) => r.mergedInto || r.id;
    fetchStatuses([...new Set(open.map(idFor))]).then((statuses) => {
      const fixed = open.filter((r) => statuses[idFor(r)]?.status === 'Resolved');
      if (!fixed.length) return;
      const ids = new Set(fixed.map((r) => r.id));
      updateReports((prev) => prev.map((r) => (ids.has(r.id) ? { ...r, status: 'Resolved' } : r)));
      const first = fixed[0];
      const where = first.location ? ` at ${first.location.split(', ').slice(0, 2).join(', ')}` : '';
      setNotice(
        fixed.length === 1
          ? `🎉 Good news: the ${first.issueType.toLowerCase()} you reported${where} has been fixed.`
          : `🎉 Good news: ${fixed.length} problems you reported have been fixed.`
      );
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Sends the user to Google and brings them back to the current screen. */
  function startSignIn() {
    const params = new URLSearchParams({ view });
    if (view === 'complaint' && activeReport) params.set('report', activeReport.id);
    signIn(`/?${params}`);
  }

  async function handleSignOut() {
    await signOut();
    setUser((u) => ({ ...u, signedIn: false, email: undefined, name: undefined, picture: undefined }));
  }

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view, activeId]);

  function updateReports(fn) {
    setReports((prev) => saveReports(fn(prev)));
  }

  const activeReport = reports.find((r) => r.id === activeId) ?? reports[0] ?? null;

  /** Mirrors a send to the admin log by uploading the full report. */
  function logStatusChange(id, status) {
    const report = reports.find((r) => r.id === id);
    // Fixing is the authority's call (admin page), so only sends are mirrored from the phone.
    if (status === 'Sent' && report && !report.mergedInto) logSent(report);
  }
  const goReport = () => setView('report');

  function enter(target) {
    try {
      sessionStorage.setItem('civiclens.entered', '1');
    } catch {
      // Storage blocked: the landing page will just show again next time.
    }
    setView(target);
    setEntered(true);
  }

  if (!entered) return <Landing onEnter={enter} user={user} onSignIn={() => signIn('/?view=report')} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <button
            className="brand"
            onClick={() => {
              try {
                sessionStorage.removeItem('civiclens.entered');
              } catch {
                // Storage blocked; going back still works for this page view.
              }
              setEntered(false);
            }}
          >
            CivicLens<span className="brand-dot">.</span>
          </button>
          <nav className="tabs" aria-label="Main">
            {(user.isAdmin ? [...TABS, ADMIN_TAB] : TABS).map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`tab ${view === id ? 'is-active' : ''}`}
                onClick={() => setView(id)}
                aria-current={view === id ? 'page' : undefined}
              >
                <Icon />
                <span>{label}</span>
                {id === 'reports' && reports.length > 0 && <span className="tab-count">{reports.length}</span>}
              </button>
            ))}
          </nav>
          <AccountButton user={user} onSignIn={startSignIn} onSignOut={handleSignOut} />
        </div>
      </header>

      <main className="main">
        {notice && (
          <div className="alert notice" role="status">
            <span>{notice}</span>
            <button className="notice-close" onClick={() => setNotice(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        {view === 'report' && (
          <ReportScreen
            onCreate={(report) => {
              updateReports((prev) => [report, ...prev]);
              setActiveId(report.id);
              setView('complaint');
            }}
          />
        )}
        {view === 'complaint' && (
          <ComplaintScreen
            report={activeReport}
            user={user}
            onSignIn={startSignIn}
            onSessionExpired={() => setUser((u) => ({ ...u, signedIn: false }))}
            onSupported={(id, mergedInto) =>
              updateReports((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'Sent', mergedInto } : r)))
            }
            onGoReport={goReport}
            onStatus={(id, status) => {
              updateReports((prev) => prev.map((r) => (r.id === id && r.status !== 'Resolved' ? { ...r, status } : r)));
              logStatusChange(id, status);
            }}
          />
        )}
        {view === 'reports' && (
          <ReportsScreen
            reports={reports}
            onGoReport={goReport}
            onOpen={(id) => {
              setActiveId(id);
              setView('complaint');
            }}
            onStatus={(id, status) => {
              updateReports((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
              logStatusChange(id, status);
            }}
            onDelete={(id) => {
              updateReports((prev) => prev.filter((r) => r.id !== id));
              deletePhoto(id);
            }}
          />
        )}
        {view === 'hotspots' && <HotspotScreen reports={reports} onGoReport={goReport} />}
        {view === 'admin' && user.isAdmin && <AdminScreen />}
      </main>
    </div>
  );
}
