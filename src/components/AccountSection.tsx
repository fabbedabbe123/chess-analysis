import { useEffect, useState } from 'react';
import { closeDialog, confirmThen, openDialog } from '@/stores/uiStore';
import { SYNC_LABEL, SYNC_NAMES } from '@/sync/keys';
import { checkUsername, deleteMyCloudData, resetLinkForm, saveUsername, sendLink, signOut, syncNow, useSync, type UsernameCheck } from '@/sync/syncStore';
import { USERNAME_MAX, USERNAME_MIN, usernameProblem } from '@/sync/profile';
import { estimateStrength } from '@/strength/strength';
import { useStrength } from '@/stores/strengthStore';
import { usePuzzle } from '@/stores/puzzleStore';
import { Modal } from './Modal';

const RESEND_WAIT_S = 60;

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

const initial = (name: string | null) => (name?.trim()[0] ?? '?').toUpperCase();
/** The e-mail address is private: it is never used as a display name. */
const shownName = (s: { profile: { username: string } | null }) => s.profile?.username ?? 'Your account';

/** Always-visible entry point: "Sign in" when signed out, the account chip (with sync state) when signed in. Hidden when the site has no sync backend. */
export function AccountButton({ variant = 'side' }: { variant?: 'side' | 'top' }) {
  const s = useSync((x) => x);
  if (!s.configured) return null;
  if (s.userId === null) {
    return (
      <button className={`account-btn signin ${variant}`} onClick={() => openDialog('account')} data-testid="account-open" title="Sign in to keep your progress on all your devices">
        <span className="account-icon" aria-hidden>☁</span>
        <span className="account-text"><strong>Sign in</strong><small>Sync across devices</small></span>
      </button>
    );
  }
  const state = s.error !== null ? 'error' : s.busy === 'syncing' ? 'syncing' : 'ok';
  const label = s.error !== null ? 'Sync problem' : s.busy === 'syncing' ? 'Syncing…' : s.lastSync !== null ? `Synced ${ago(s.lastSync)}` : 'Signed in';
  return (
    <button className={`account-btn signed ${variant}`} onClick={() => openDialog('account')} data-testid="account-open" title="Your profile and sync">
      <span className="account-avatar" aria-hidden>{initial(s.profile?.username ?? null)}<i className={`dot ${state}`} /></span>
      <span className="account-text"><strong>{shownName(s)}</strong><small>{s.profileLoaded && s.profile === null ? 'Choose a username' : label}</small></span>
    </button>
  );
}

/** Start-page card for visitors who are not signed in. */
export function SignInBanner() {
  const configured = useSync((x) => x.configured);
  const signedIn = useSync((x) => x.userId !== null);
  if (!configured || signedIn) return null;
  return (
    <section className="signin-banner" aria-label="Sign in" data-testid="signin-banner">
      <span className="account-icon" aria-hidden>☁</span>
      <div>
        <strong>Take your progress with you</strong>
        <p>Sign in with just your e-mail (no password) and your games, puzzle progress and settings follow you to every device. It is optional.</p>
      </div>
      <button className="btn primary" onClick={() => openDialog('account')} data-testid="banner-signin">Sign in</button>
    </section>
  );
}

function Benefits() {
  return (
    <ul className="benefits">
      <li><span aria-hidden>⇄</span> Use your games, puzzle progress and settings on any device</li>
      <li><span aria-hidden>✉</span> No password: you get a one-time link by e-mail</li>
      <li><span aria-hidden>🔒</span> Only you can read your data, and you can delete it at any time</li>
    </ul>
  );
}

function SignInForm() {
  const s = useSync((x) => x);
  const [email, setEmail] = useState('');
  const [now, setNow] = useState(Date.now());
  const sent = s.linkSentTo !== null;
  useEffect(() => {
    if (!sent) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sent]);

  if (sent && s.linkSentTo !== null) {
    const wait = Math.max(0, RESEND_WAIT_S - Math.floor((now - (s.linkSentAt ?? now)) / 1000));
    return (
      <div className="signin-sent" role="status" data-testid="account-link-sent">
        <span className="big-icon" aria-hidden>✉</span>
        <h3>Check your e-mail</h3>
        <p>We sent a sign-in link to <strong>{s.linkSentTo}</strong>. Open it on this device and you are signed in. It can take a minute, and it may land in spam.</p>
        <div className="row wrap">
          <button className="btn" disabled={wait > 0 || s.busy !== 'idle'} onClick={() => void sendLink(s.linkSentTo ?? '')} data-testid="account-resend">{wait > 0 ? `Send again in ${wait} s` : s.busy === 'sending' ? 'Sending…' : 'Send again'}</button>
          <button className="btn" onClick={resetLinkForm} data-testid="account-other-email">Use another e-mail</button>
        </div>
      </div>
    );
  }
  return (
    <form className="signin-form" onSubmit={(e) => { e.preventDefault(); void sendLink(email); }}>
      <label className="field">
        <span>E-mail address</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" autoFocus data-testid="account-email" />
      </label>
      <button className="btn primary big" type="submit" disabled={s.busy !== 'idle' || email.trim() === ''} data-testid="account-send">{s.busy === 'sending' ? 'Sending…' : 'Email me a sign-in link'}</button>
      <p className="muted small-print">New here? The same link creates your account. We only use the address to sign you in.</p>
    </form>
  );
}

/** Pick (or change) the unique username. Availability is checked live; the database enforces uniqueness. */
function UsernameForm({ first }: { first: boolean }) {
  const current = useSync((x) => x.profile?.username ?? '');
  const [name, setName] = useState(current);
  const [check, setCheck] = useState<UsernameCheck | 'checking' | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setErr(null);
    if (name === '' || name === current) { setCheck(null); return undefined; }
    const p = usernameProblem(name);
    if (p !== null) { setCheck({ problem: p }); return undefined; }
    setCheck('checking');
    let alive = true;
    const t = setTimeout(() => { void checkUsername(name).then((r) => { if (alive) setCheck(r); }); }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [name, current]);
  const msg = check === null ? null : check === 'checking' ? 'Checking…' : check === 'ok' ? 'Available' : check === 'taken' ? 'Already taken' : check === 'same' ? null : check === 'error' ? 'Could not check right now; you can still try to save.' : check.problem;
  const good = check === 'ok';
  const canSave = !saving && name !== current && (check === 'ok' || check === 'error');
  return (
    <form className="signin-form" onSubmit={(e) => { e.preventDefault(); if (!canSave) return; setSaving(true); void saveUsername(name).then((r) => { setSaving(false); setErr(r); }); }}>
      <label className="field">
        <span>{first ? 'Choose your username' : 'Username'}</span>
        <input value={name} onChange={(e) => setName(e.target.value.trim())} maxLength={USERNAME_MAX} placeholder="e.g. knight_rider" autoComplete="off" spellCheck={false} autoFocus={first} data-testid="username-input" />
      </label>
      <div className={`hint ${good ? 'good' : msg !== null && check !== 'checking' && check !== 'error' ? 'bad' : ''}`} aria-live="polite" data-testid="username-hint">{msg ?? `${USERNAME_MIN}-${USERNAME_MAX} characters: letters, digits and _. Must be unique.`}</div>
      <button className="btn primary big" type="submit" disabled={!canSave} data-testid="username-save">{saving ? 'Saving…' : first ? 'Create my profile' : 'Save username'}</button>
      {err !== null && <div className="callout error small" role="alert" data-testid="username-error">{err}</div>}
    </form>
  );
}

/** f***@gmail.com */
export function maskEmail(email: string | null): string {
  if (email === null) return '–';
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="stat-tile"><strong>{value}</strong><span>{label}</span>{note !== undefined && <small>{note}</small>}</div>;
}

/** Everything about "me": identity, level, progress, sync and data. */
function ProfileView() {
  const s = useSync((x) => x);
  const games = useStrength((g) => g.games);
  const progress = usePuzzle((p) => p.progress);
  const [showEmail, setShowEmail] = useState(false);
  const est = estimateStrength(games);
  const solved = Object.keys(progress.solved).length;
  const member = s.profile !== null && s.profile.createdAt > 0 ? new Date(s.profile.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
  return (
    <>
      <div className="account-card">
        <span className="account-avatar big" aria-hidden>{initial(s.profile?.username ?? null)}</span>
        <div>
          <div className="profile-name" data-testid="profile-name">{s.profile?.username ?? ''}</div>
          <div className="muted small-print" data-testid="account-status">Signed in{member !== null && ` · member since ${member}`}</div>
        </div>
      </div>

      <h3>E-mail</h3>
      <p className="small-print" data-testid="account-email-row">
        {showEmail ? <strong data-testid="account-email-shown">{s.email ?? '–'}</strong> : <span data-testid="account-email-hidden">{maskEmail(s.email)}</span>}{' '}
        <button className="linklike" onClick={() => setShowEmail(!showEmail)} data-testid="account-email-toggle">{showEmail ? 'Hide' : 'Show'}</button>
      </p>
      <p className="muted small-print">Only you can see this. It is used just to sign you in and is never shown to other people.</p>

      <h3>Your progress</h3>
      <div className="stat-grid" data-testid="profile-stats">
        <Stat label="Estimated level" value={est === null ? '–' : `${est.low}–${est.high}`} note={est === null ? 'analyse a few games' : 'rough estimate'} />
        <Stat label="Analysed games" value={String(games.length)} />
        <Stat label="Puzzles solved" value={String(solved)} />
        <Stat label="Best puzzle streak" value={String(progress.bestStreak)} />
      </div>

      <h3>Username</h3>
      <UsernameForm first={false} />

      <h3>Sync</h3>
      <p className="muted small-print">{s.busy === 'syncing' ? 'Syncing…' : s.lastSync !== null ? `Synced ${ago(s.lastSync)}` : 'Not synced yet'} · changes upload automatically. Synced between devices: {SYNC_NAMES.map((n) => SYNC_LABEL[n]).join(', ')}. Not synced: the game on the board, downloaded Chess.com/Lichess games, the Lichess token. If two devices changed the same data, lists are merged; other settings keep the newer version.</p>
      <div className="row wrap">
        <button className="btn primary" onClick={() => void syncNow(true)} disabled={s.busy !== 'idle'} data-testid="account-sync">{s.busy === 'syncing' ? 'Syncing…' : 'Sync now'}</button>
        <button className="btn" onClick={() => openDialog('settings')} data-testid="profile-settings">Settings &amp; backup</button>
        <button className="btn" onClick={() => void signOut()} data-testid="account-signout">Sign out</button>
      </div>
      <details className="fold">
        <summary>Delete my cloud data</summary>
        <p className="muted small-print">Removes the progress and settings this account stored in the cloud. Your username and this device's copy stay.</p>
        <button className="btn danger" onClick={() => confirmThen(true, 'Delete everything stored in the cloud for this account? This device keeps its own copy.', 'Delete cloud data', () => void deleteMyCloudData())} data-testid="account-delete">Delete cloud data</button>
      </details>
    </>
  );
}

/** The sign-in / profile dialog. */
export function AccountDialog() {
  const s = useSync((x) => x);
  const needsName = s.userId !== null && s.profileLoaded && s.profile === null;
  const title = s.userId === null ? 'Sign in' : needsName ? 'Choose a username' : 'Your profile';
  return (
    <Modal title={title} onClose={closeDialog}>
      <div className="account-dialog" data-testid="account-dialog">
        {!s.configured ? (
          <p className="muted" data-testid="account-off">Cloud sync is not set up on this site, so everything stays in this browser.</p>
        ) : s.userId === null ? (
          <>
            <p className="lead">Keep your progress safe and pick up on any device.</p>
            <Benefits />
            <SignInForm />
          </>
        ) : needsName ? (
          <>
            <p className="lead">Welcome! Pick a unique username for your profile.</p>
            <p className="muted small-print">It identifies you in the app (and later to friends). You can change it any time.</p>
            <UsernameForm first />
          </>
        ) : !s.profileLoaded ? (
          <p className="muted">Loading your profile…</p>
        ) : (
          <ProfileView />
        )}
        {s.error !== null && <div className="callout error small" role="alert" data-testid="account-error">{s.error}</div>}
      </div>
    </Modal>
  );
}

/** Settings → Account: a short summary with a button into the dialog. */
export function AccountSettingsRow() {
  const s = useSync((x) => x);
  if (!s.configured) {
    return (
      <fieldset data-testid="account">
        <legend>Account</legend>
        <p className="muted small-print" data-testid="account-off">Cloud sync is not set up on this site, so everything stays in this browser. (It needs a Supabase project; see the README.)</p>
      </fieldset>
    );
  }
  return (
    <fieldset data-testid="account">
      <legend>Account</legend>
      <p className="small-print">{s.userId === null ? 'Not signed in. Everything stays in this browser.' : <><strong>{shownName(s)}</strong>.</>}</p>
      <button className="btn" onClick={() => openDialog('account')} data-testid="settings-account">{s.userId === null ? 'Sign in…' : 'Open profile…'}</button>
    </fieldset>
  );
}
