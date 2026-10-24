import { ArrowRightIcon, GoogleIcon } from '../components/Icons.jsx';

// 'asphalt' = night street with road markings; 'warm' = the earlier soft peach theme.
const THEME = 'asphalt';

/** First screen a visitor sees: one hook line and one way in. */
export default function Landing({ onEnter, user, onSignIn }) {
  // Sign in first so everything after the photo (drafting, sending) is automatic.
  const askSignIn = user.configured && !user.signedIn;
  const firstName = (user.name || '').split(' ')[0];

  return (
    <div className={`landing theme-${THEME}`}>
      <div className="landing-bg" aria-hidden>
        {THEME === 'warm' ? (
          <>
            <span className="blob blob-1" />
            <span className="blob blob-2" />
            <span className="blob blob-3" />
            <span className="blob blob-4" />
          </>
        ) : (
          <>
            <span className="streetlight" />
            <span className="road">
              <span className="road-line" />
            </span>
          </>
        )}
        <span className="grain" />
      </div>

      <header className="landing-nav">
        <span className="landing-logo">
          CivicLens<span className="landing-dot">.</span>
        </span>
        <button className="landing-link" onClick={() => onEnter('reports')}>
          My reports
        </button>
      </header>

      <main className="landing-hero">
        <h1 className="landing-title">
          <span className="landing-line">Complaining is hard.</span>
          <em className="landing-line landing-accent">We made it easy.</em>
        </h1>
        <p className="landing-sub">One photo. Right department. Sent.</p>
        <div className={`landing-actions ${user.loading ? 'is-loading' : ''}`}>
          {askSignIn ? (
            <>
              <button className="landing-cta" onClick={onSignIn}>
                <span className="landing-g">
                  <GoogleIcon size={18} />
                </span>
                Continue with Google
              </button>
              <button className="landing-skip" onClick={() => onEnter('report')}>
                Continue without signing in
              </button>
            </>
          ) : (
            <>
              <button className="landing-cta" onClick={() => onEnter('report')}>
                Report an issue <ArrowRightIcon width={18} height={18} />
              </button>
              {user.signedIn && <p className="landing-signed">Signed in as {firstName || user.email}</p>}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
