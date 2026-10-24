import { useEffect, useRef, useState } from 'react';

/** Top-bar account control: "Sign in" when signed out, avatar + small menu when signed in. */
export default function AccountButton({ user, onSignIn, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  if (user.loading || !user.configured) return null;

  if (!user.signedIn) {
    return (
      <button className="account-signin" onClick={onSignIn}>
        Sign in
      </button>
    );
  }

  const initial = (user.name || user.email || '?').trim()[0].toUpperCase();
  return (
    <div className="account" ref={ref}>
      <button className="account-avatar" onClick={() => setOpen((o) => !o)} aria-label="Account" aria-expanded={open}>
        {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span>{initial}</span>}
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <p className="account-name">{user.name}</p>
          <p className="account-email">{user.email}</p>
          <button
            className="account-signout"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
