import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { COMPLAINT_EMAIL } from '../lib/constants.js';
import { authorityFor } from '../lib/authorities.js';
import { englishLetter, englishSubject, escalationEmail, kannadaLetter } from '../lib/letters.js';
import { addSupport, checkNearby } from '../lib/reportsApi.js';
import { geocodeText, locateNow } from '../lib/location.js';
import { sendComplaint } from '../lib/auth.js';
import { loadPhoto } from '../lib/photos.js';
import { SeverityBadge } from '../components/Badges.jsx';
import { CheckIcon, CopyIcon, DocIcon, EditIcon, GoogleIcon, MailIcon, PinIcon } from '../components/Icons.jsx';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

// Gmail rejects compose links longer than ~8,100 characters (measured); stay just under that.
const MAX_LINK_LENGTH = 8000;

const COMPOSERS = {
  gmail: (to, su, body) =>
    `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`,
  outlook: (to, su, body) =>
    `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`,
};

// Plain ASCII: each box-drawing character would cost 9 characters in the compose link.
const SEPARATOR = '\n\n--------------------\n\n';

/**
 * One email with both letters. The Kannada copy starts at its subject line: the addressee and
 * date are already in the English letter above, and every Kannada character costs 9 in a link.
 */
function emailBody(en, kn) {
  const subjectAt = kn.indexOf('ವಿಷಯ:');
  const knBody = subjectAt > 0 ? kn.slice(subjectAt) : kn;
  return `${en}${SEPARATOR}ಕನ್ನಡ ಆವೃತ್ತಿ (Kannada version)\n\n${knBody}`;
}

/**
 * Opens a web compose window with both letters. In the rare case they're too long for a link,
 * opens the default mail app instead (mailto has no such limit). Returns which route was used.
 */
function openCompose(service, subject, en, kn) {
  const body = emailBody(en, kn);
  const url = COMPOSERS[service](COMPLAINT_EMAIL, subject, body);
  if (url.length > MAX_LINK_LENGTH) {
    window.location.href = `mailto:${COMPLAINT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return 'mailto';
  }
  window.open(url, '_blank', 'noopener');
  return service;
}

/**
 * Full-screen letter editor. Sized to the visible viewport, so the mobile keyboard never covers
 * the text, and 16px text so phones don't auto-zoom (that zoom was the "shake" when tapping).
 */
function LetterEditor({ title, lang, value, onChange, onClose }) {
  const [box, setBox] = useState(() => ({
    top: window.visualViewport?.offsetTop ?? 0,
    height: window.visualViewport?.height ?? window.innerHeight,
  }));

  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setBox({ top: vv?.offsetTop ?? 0, height: vv?.height ?? window.innerHeight });
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // the page behind must not scroll while editing
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="editor" role="dialog" aria-modal="true" aria-label={`Edit ${title} letter`} style={box}>
      <div className="editor-bar">
        <span className="editor-title">{title} letter</span>
        <button className="btn btn-primary btn-sm" onClick={onClose}>
          Done
        </button>
      </div>
      <textarea
        className={`editor-text ${lang === 'kn' ? 'kn' : ''}`}
        value={value}
        lang={lang}
        spellCheck={lang === 'en'}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
      />
    </div>,
    document.body
  );
}

/** Both letters in one card: switch language with tabs, short read-only preview, edit full-screen. */
function LettersCard({ en, kn, setEn, setKn }) {
  const [lang, setLang] = useState('en');
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = lang === 'en' ? en : kn;
  const title = lang === 'en' ? 'English' : 'ಕನ್ನಡ';

  async function handleCopy() {
    await copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className="card letters">
      <div className="letters-head">
        <div className="seg" role="tablist" aria-label="Letter language">
          <button
            role="tab"
            aria-selected={lang === 'en'}
            className={lang === 'en' ? 'is-on' : ''}
            onClick={() => setLang('en')}
          >
            English
          </button>
          <button
            role="tab"
            aria-selected={lang === 'kn'}
            className={`kn-label ${lang === 'kn' ? 'is-on' : ''}`}
            onClick={() => setLang('kn')}
          >
            ಕನ್ನಡ
          </button>
        </div>
        <div className="letters-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            <EditIcon width={16} height={16} /> Edit
          </button>
          <button className={`btn btn-ghost btn-sm ${copied ? 'is-done' : ''}`} onClick={handleCopy}>
            {copied ? <CheckIcon width={16} height={16} /> : <CopyIcon width={16} height={16} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <div className={`letter-wrap ${expanded ? 'is-open' : ''}`}>
        <div className={`letter letter-preview ${lang === 'kn' ? 'kn' : ''}`} lang={lang}>
          {text}
        </div>
        {!expanded && (
          <button className="letter-more" onClick={() => setExpanded(true)}>
            Show full letter
          </button>
        )}
      </div>
      {editing && (
        <LetterEditor
          title={title}
          lang={lang}
          value={text}
          onChange={lang === 'en' ? setEn : setKn}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

/**
 * Shown instead of the send button when the same kind of problem was already reported within ~15 m and
 * isn't fixed yet: the user adds their photo to that complaint rather than emailing a duplicate.
 */
function DuplicatePanel({ match, user, onSignIn, onSupport, onDifferent, support }) {
  const working = support.status === 'working';
  return (
    <div className="card dup-card">
      <p className="eyebrow">Already reported here</p>
      <h2 className="dup-title">
        {match.issueType} · {people(match.supporters)} so far
      </h2>
      <p className="dup-text">
        First reported on {fmtDate(match.firstReportedAt)}, {match.distanceM} m from you, and not fixed yet. To keep
        the office from getting the same email again and again, your photo is added to that complaint instead.
        {' '}They get one escalation email as more people report it.
      </p>
      {match.alreadySupported ? (
        <p className="send-meta is-success">You've already reported this one. Thank you!</p>
      ) : user.configured && !user.signedIn ? (
        <button className="btn btn-primary btn-lg btn-block" onClick={onSignIn}>
          <GoogleIcon /> Sign in to add your support
        </button>
      ) : (
        <button className="btn btn-primary btn-lg btn-block" onClick={onSupport} disabled={working}>
          {working ? (
            <>
              <span className="spinner" /> Adding…
            </>
          ) : (
            <>Add my support</>
          )}
        </button>
      )}
      {support.status === 'error' && <p className="send-meta is-error">{support.message}</p>}
      <button className="link-btn dup-different" onClick={onDifferent}>
        This is a different problem, send a new complaint
      </button>
    </div>
  );
}

/**
 * Shown when no location could be found (no GPS fix, no photo location). Never guesses: the user types
 * an area or landmark, which is looked up on the map so the letter still gets an address, pin and the right office.
 */
function LocationFix({ onFound }) {
  const [text, setText] = useState('');
  const [state, setState] = useState({ busy: '', error: '' });

  async function find(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setState({ busy: 'find', error: '' });
    try {
      const place = await geocodeText(text);
      if (!place) setState({ busy: '', error: "Couldn't find that place. Try adding the area and city, e.g. \"Kuvempunagar, Mysuru\"." });
      else onFound(place);
    } catch {
      setState({ busy: '', error: "Couldn't reach the map service. Check your connection and try again." });
    }
  }

  async function retryGps() {
    setState({ busy: 'gps', error: '' });
    const place = await locateNow();
    if (place.error) setState({ busy: '', error: `${place.error} Type the area instead.` });
    else onFound(place);
  }

  return (
    <div className="card locfix">
      <p className="eyebrow">Location needed</p>
      <h2 className="dup-title">Where is this problem?</h2>
      <p className="dup-text">
        We couldn't get your location, so the complaint has no address yet. Type the area or a landmark nearby.
      </p>
      <form className="locfix-row" onSubmit={find}>
        <input
          className="locfix-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Kuvempunagar, Mysuru"
          aria-label="Area or landmark"
        />
        <button className="btn btn-primary" type="submit" disabled={Boolean(state.busy)}>
          {state.busy === 'find' ? 'Finding…' : 'Find'}
        </button>
      </form>
      <button className="link-btn locfix-gps" onClick={retryGps} disabled={Boolean(state.busy)}>
        {state.busy === 'gps' ? 'Getting GPS…' : 'Or try GPS again'}
      </button>
      {state.error && <p className="send-meta is-error">{state.error}</p>}
    </div>
  );
}

export default function ComplaintScreen({
  report,
  user,
  onSignIn,
  onSessionExpired,
  onStatus,
  onSupported,
  onUpdateReport,
  onGoReport,
}) {
  const [en, setEn] = useState('');
  const [kn, setKn] = useState('');
  const [sentVia, setSentVia] = useState(null);
  const [direct, setDirect] = useState({ status: 'idle', message: '' }); // idle | sending | sent | error

  // The signed-in user's real name goes on the letters; otherwise "A concerned citizen".
  const signerName = report?.name || (user.signedIn ? user.name : '');
  useEffect(() => {
    if (!report) return;
    const signed = { ...report, name: signerName };
    setEn(englishLetter(signed));
    setKn(kannadaLetter(signed));
    setDirect({ status: 'idle', message: '' });
    setSentVia(null);
  }, [report?.id, signerName, report?.location]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same problem already reported nearby and still open? Only checked before this report is sent.
  const [nearby, setNearby] = useState({ match: null, dismissed: false });
  const [support, setSupport] = useState({ status: 'idle', message: '', result: null });
  useEffect(() => {
    setNearby({ match: null, dismissed: false });
    setSupport({ status: 'idle', message: '', result: null });
    if (!report || report.status !== 'Drafted' || report.mergedInto) return undefined;
    let live = true;
    checkNearby(report).then((match) => live && setNearby({ match, dismissed: false }));
    return () => {
      live = false;
    };
  }, [report?.id, report?.coords?.lat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Full-size photo for the attachment; older reports only have the thumbnail.
  const [photo, setPhoto] = useState(null);
  useEffect(() => {
    if (!report) return undefined;
    let live = true;
    loadPhoto(report.id).then((p) => live && setPhoto(p ?? report.thumb));
    return () => {
      live = false;
    };
  }, [report?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!report) {
    return (
      <div className="screen">
        <div className="empty">
          <div className="empty-icon">
            <DocIcon width={26} height={26} />
          </div>
          <h2>No complaint yet</h2>
          <p>Report an issue with a photo and your complaint letter will appear here.</p>
          <button className="btn btn-primary" onClick={onGoReport}>
            Report an issue
          </button>
        </div>
      </div>
    );
  }

  const authority = authorityFor(report);
  const subject = englishSubject(report);
  const mailto =
    `mailto:${COMPLAINT_EMAIL}?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(emailBody(en, kn))}`;
  const send = (service) => {
    onStatus(report.id, 'Sent');
    setSentVia(openCompose(service, subject, en, kn));
  };

  /** Sends from the signed-in Gmail via our server, with both full letters and the photo attached. */
  async function sendDirect() {
    setDirect({ status: 'sending', message: '' });
    try {
      await sendComplaint({ subject, body: `${en}${SEPARATOR}${kn}`, photo, reportId: report.id });
      onStatus(report.id, 'Sent');
      setDirect({ status: 'sent', message: '' });
    } catch (e) {
      if (e.kind === 'signin') onSessionExpired();
      setDirect({ status: 'error', message: e.message });
    }
  }

  const canSendDirect = user.configured && user.signedIn;

  /** Adds this photo to the existing complaint; at a milestone, also emails the authority once. */
  async function handleSupport() {
    setSupport({ status: 'working', message: '', result: null });
    try {
      const res = await addSupport(nearby.match.id, report);
      let escalated = false;
      let escalationError = '';
      if (res.escalate && canSendDirect) {
        const mail = escalationEmail(res.report, res.supporters, signerName);
        try {
          await sendComplaint({ subject: mail.subject, body: mail.body, photo });
          escalated = true;
        } catch (e) {
          escalationError = e.message;
        }
      }
      onSupported(report.id, nearby.match.id);
      setSupport({
        status: 'done',
        message: '',
        result: { supporters: res.supporters ?? nearby.match.supporters, already: res.already, escalated, escalationError },
      });
    } catch (e) {
      if (e.kind === 'signin') onSessionExpired();
      setSupport({ status: 'error', message: e.message, result: null });
    }
  }

  // No address and no GPS pin: don't guess an office or send a letter with a blank location.
  const needsLocation = !report.location && !report.coords && report.status === 'Drafted';
  // Where the problem is: the street and area, or the GPS pin when there's no street name.
  const where = report.location
    ? report.location.split(', ').slice(0, 3).join(', ')
    : report.coords
      ? `${report.coords.lat.toFixed(5)}, ${report.coords.lon.toFixed(5)}`
      : '';

  const showDuplicate = nearby.match && !nearby.dismissed && support.status !== 'done' && report.status === 'Drafted';

  return (
    <div className="screen">
      <header className="screen-head">
        <p className="eyebrow">Ready to send</p>
        <h1>Your complaint</h1>
      </header>

      {needsLocation && (
        <LocationFix
          onFound={(place) =>
            onUpdateReport(report.id, {
              location: place.address || '',
              area: place.area ?? null,
              coords: { lat: place.lat, lon: place.lon, accuracy: place.accuracy, source: place.source },
            })
          }
        />
      )}

      <div className="card summary-card">
        <img src={report.thumb} alt="" className="summary-thumb" />
        <div className="summary-body">
          <div className="summary-top">
            <strong>{report.issueType}</strong>
            <SeverityBadge severity={report.severity} />
          </div>
          <p className="summary-to">
            {needsLocation ? 'Add a location to find the right office' : <>To <span>{authority.short}</span></>}
          </p>
          {where && (
            <p className="summary-where" title={report.location || where}>
              <PinIcon width={14} height={14} />
              <span>{where}</span>
            </p>
          )}
        </div>
      </div>

      {support.status === 'done' || report.mergedInto ? (
        <div className="card dup-card dup-done">
          <p className="eyebrow">Support added</p>
          <h2 className="dup-title">
            {support.result?.already
              ? "You've already reported this one"
              : support.result
                ? `${people(support.result.supporters)} have now reported this`
                : 'Added to an existing complaint'}
          </h2>
          <p className="dup-text">
            {support.result?.escalated
              ? 'That was a milestone, so an escalation email just went to the authority from your Gmail, with your photo.'
              : support.result?.escalationError
                ? `It reached a milestone, but the escalation email failed: ${support.result.escalationError}`
                : 'No duplicate email was sent. The authority gets one escalation email as more people report it.'}
            {' '}You'll be told when it's fixed.
          </p>
        </div>
      ) : needsLocation ? null : showDuplicate ? (
        <DuplicatePanel
          match={nearby.match}
          user={user}
          onSignIn={onSignIn}
          onSupport={handleSupport}
          onDifferent={() => setNearby((n) => ({ ...n, dismissed: true }))}
          support={support}
        />
      ) : (
      <div className="send-panel">
        {user.configured && !user.signedIn ? (
          <button className="btn btn-primary btn-lg btn-block" onClick={onSignIn}>
            <GoogleIcon /> Sign in with Google to send
          </button>
        ) : canSendDirect ? (
          <button
            className={`btn btn-primary btn-lg btn-block ${direct.status === 'sent' ? 'is-sent' : ''}`}
            onClick={sendDirect}
            disabled={direct.status === 'sending' || direct.status === 'sent'}
          >
            {direct.status === 'sending' ? (
              <>
                <span className="spinner" /> Sending…
              </>
            ) : direct.status === 'sent' ? (
              <>
                <CheckIcon /> Sent
              </>
            ) : (
              <>
                <MailIcon /> Send with Gmail
              </>
            )}
          </button>
        ) : (
          <button className="btn btn-primary btn-lg btn-block" onClick={() => send('gmail')}>
            <MailIcon /> Send with Gmail
          </button>
        )}

        {direct.status === 'sent' ? (
          <p className="send-meta is-success">Sent with both letters and the photo.</p>
        ) : direct.status === 'error' ? (
          <p className="send-meta is-error">{direct.message}</p>
        ) : sentVia === 'mailto' ? (
          <p className="send-meta">Too long for a web link, so it opened in your mail app.</p>
        ) : canSendDirect ? (
          <p className="send-meta">
            From {user.email} to {COMPLAINT_EMAIL} · photo attached
          </p>
        ) : user.configured ? (
          <p className="send-meta">Sign in once and CivicLens sends it from your Gmail, photo attached.</p>
        ) : (
          <p className="send-meta">{COMPLAINT_EMAIL}</p>
        )}

        <p className="send-alt">
          or open in{' '}
          <button className="link-btn" onClick={() => send('outlook')}>
            Outlook
          </button>{' '}
          ·{' '}
          <a className="link-btn" href={mailto} onClick={() => onStatus(report.id, 'Sent')}>
            another app
          </a>
        </p>
      </div>
      )}

      {!showDuplicate && !report.mergedInto && support.status !== 'done' && (
        <LettersCard en={en} kn={kn} setEn={setEn} setKn={setKn} />
      )}
    </div>
  );
}
