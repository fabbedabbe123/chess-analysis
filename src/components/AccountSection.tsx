import { useEffect, useState } from 'react';
import { closeDialog, confirmThen, openDialog } from '@/stores/uiStore';
import { SYNC_LABEL, SYNC_NAMES } from '@/sync/keys';
import { checkUsername, deleteMyCloudData, resetLinkForm, saveAvatar, saveUsername, sendLink, setSharePresence, setShareStats, signOut, syncNow, useSync, type UsernameCheck } from '@/sync/syncStore';
import { USERNAME_MAX, USERNAME_MIN, usernameProblem } from '@/sync/profile';
import { useStrength } from '@/stores/strengthStore';
import { usePuzzle } from '@/stores/puzzleStore';
import { buildStats, presenceOf } from '@/sync/social';
import { resizeToAvatar } from '@/utils/avatar';
import { Avatar } from './Avatar';
import { FriendProfile, FriendsPanel, StatTiles } from './FriendsPanel';
import { Modal } from './Modal';

const RESEND_WAIT_S = 60;
/** The address Supabase sends the sign-in mail from (set in Supabase → Authentication → SMTP). Shown so people can find it. */
const AUTH_SENDER = 'ChessAnalysis.Auth@gmail.com';

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

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
  const requests = (s.friends ?? []).filter((f) => f.status === 'pending' && f.incoming).length;
  const onlineNow = (s.friends ?? []).filter((f) => f.status === 'accepted' && presenceOf(f).online).length;
  const label = s.profileLoaded && s.profile === null ? 'Choose a username' : requests > 0 ? `${requests} friend request${requests === 1 ? '' : 's'}` : onlineNow > 0 ? `${onlineNow} friend${onlineNow === 1 ? '' : 's'} online` : s.error !== null ? 'Sync problem' : s.busy === 'syncing' ? 'Syncing…' : s.lastSync !== null ? `Synced ${ago(s.lastSync)}` : 'Signed in';
  return (
    <button className={`account-btn signed ${variant}`} onClick={() => openDialog('account')} data-testid="account-open" title={`${shownName(s)} · ${label}`}>
      <span className="avatar-wrap"><Avatar name={s.profile?.username ?? null} src={s.profile?.avatar} size={30} /><i className={`dot ${state}`} />{requests > 0 && <b className="badge-count" aria-hidden>{requests}</b>}</span>
      <span className="account-text"><strong>{shownName(s)}</strong><small>{label}</small></span>
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
        <p>We sent a sign-in link to <strong>{s.linkSentTo}</strong>. Open it on this device and you are signed in. It can take a minute.</p>
        <div className="callout warn small" data-testid="spam-note">⚠ <strong>Check your spam folder.</strong> The e-mail very likely ends up there. It comes from {AUTH_SENDER}. If you find it, mark it as "not spam".</div>
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
      <div className="callout warn small" data-testid="spam-hint">⚠ The sign-in e-mail will most likely end up in your <strong>spam folder</strong>. Look there if it does not arrive within a minute.</div>
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

/** Your own profile as friends see it: picture, name, numbers, and your friends. */
function ProfileView() {
  const s = useSync((x) => x);
  const games = useStrength((g) => g.games);
  const progress = usePuzzle((p) => p.progress);
  const stats = buildStats(games, progress);
  const [openId, setOpenId] = useState<string | null>(null);
  const openFriend = openId === null ? undefined : s.friends?.find((f) => f.friendshipId === openId && f.status === 'accepted');
  if (openFriend !== undefined) return <FriendProfile friend={openFriend} onBack={() => setOpenId(null)} />;
  const member = s.profile !== null && s.profile.createdAt > 0 ? new Date(s.profile.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
  return (
    <>
      <div className="account-card">
        <Avatar name={s.profile?.username ?? null} src={s.profile?.avatar} size={72} />
        <div className="grow">
          <div className="profile-name" data-testid="profile-name">{s.profile?.username ?? ''}</div>
          <div className="muted small-print" data-testid="account-status">{member !== null ? `Member since ${member}` : 'Signed in'}</div>
        </div>
        <button className="btn" onClick={() => openDialog('settings')} data-testid="profile-settings">Edit profile &amp; settings</button>
      </div>

      <h3>Your numbers</h3>
      <StatTiles stats={stats} own />
      <p className="muted small-print">{s.shareStats ? 'Your friends can see these numbers. You can turn that off in Settings → Account.' : 'Sharing is off: friends cannot see these numbers.'}</p>

      <h3>Friends</h3>
      <FriendsPanel onOpen={setOpenId} />
    </>
  );
}

/** Settings → Account: picture, username, e-mail, privacy, sync, sign out and deleting cloud data. */
export function AccountSettings() {
  const s = useSync((x) => x);
  const [showEmail, setShowEmail] = useState(false);
  const [picError, setPicError] = useState<string | null>(null);
  const [picBusy, setPicBusy] = useState(false);

  if (!s.configured) {
    return (
      <fieldset data-testid="account" className="span-all">
        <legend>Account</legend>
        <p className="muted small-print" data-testid="account-off">Cloud sync is not set up on this site, so everything stays in this browser. (It needs a Supabase project; see the README.)</p>
      </fieldset>
    );
  }
  if (s.userId === null) {
    return (
      <fieldset data-testid="account" className="span-all">
        <legend>Account</legend>
        <p className="small-print">Not signed in. Everything stays in this browser. Sign in to sync your progress, get a profile and add friends.</p>
        <button className="btn primary" onClick={() => openDialog('account')} data-testid="settings-account">Sign in…</button>
      </fieldset>
    );
  }
  const pickPicture = async (file: File | undefined) => {
    if (file === undefined) return;
    setPicError(null); setPicBusy(true);
    try {
      const url = await resizeToAvatar(file);
      setPicError(await saveAvatar(url));
    } catch (e) {
      setPicError(e instanceof Error ? e.message : 'That picture could not be used.');
    } finally {
      setPicBusy(false);
    }
  };
  return (
    <fieldset data-testid="account" className="span-all account-settings">
      <legend>Account</legend>
      <div className="account-cols">
        <section>
          <h3>Profile picture</h3>
          <div className="pic-row">
            <Avatar name={s.profile?.username ?? null} src={s.profile?.avatar} size={64} />
            <div className="stack">
              <label className="btn" style={{ cursor: 'pointer' }}>
                {picBusy ? 'Saving…' : 'Upload picture…'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { void pickPicture(e.target.files?.[0]); e.target.value = ''; }} data-testid="avatar-input" disabled={picBusy || s.profile === null} />
              </label>
              {s.profile?.avatar != null && <button className="btn small" onClick={() => void saveAvatar(null)} data-testid="avatar-remove">Remove picture</button>}
            </div>
          </div>
          <p className="muted small-print">The picture is cropped to a square and shrunk to {128} px. Your friends can see it.</p>
          {picError !== null && <div className="callout error small" role="alert" data-testid="avatar-error">{picError}</div>}

          <h3>Username</h3>
          <UsernameForm first={s.profile === null} />
        </section>

        <section>
          <h3>E-mail</h3>
          <p className="small-print" data-testid="account-email-row">
            {showEmail ? <strong data-testid="account-email-shown">{s.email ?? '–'}</strong> : <span data-testid="account-email-hidden">{maskEmail(s.email)}</span>}{' '}
            <button className="linklike" onClick={() => setShowEmail(!showEmail)} data-testid="account-email-toggle">{showEmail ? 'Hide' : 'Show'}</button>
          </p>
          <p className="muted small-print">Only you can see this. It is used just to sign you in and is never shown to other people.</p>

          <h3>Friends and privacy</h3>
          <label className="field check">
            <input type="checkbox" checked={s.shareStats} onChange={(e) => setShareStats(e.target.checked)} data-testid="share-stats" />
            <span>Show my level, puzzle and game numbers to my friends</span>
          </label>
          <label className="field check">
            <input type="checkbox" checked={s.sharePresence} onChange={(e) => setSharePresence(e.target.checked)} data-testid="share-presence" />
            <span>Show friends when I am online and what I am doing</span>
          </label>
          <p className="muted small-print">Friends only see your username, picture, these numbers and (if allowed) a status like "Online · Solving puzzles" or when you were last here. Never your games, moves, e-mail or settings. Turn the status off and you appear offline.</p>

          <h3>Sync</h3>
          <p className="muted small-print">{s.busy === 'syncing' ? 'Syncing…' : s.lastSync !== null ? `Synced ${ago(s.lastSync)}` : 'Not synced yet'} · changes upload automatically. Synced between devices: {SYNC_NAMES.map((n) => SYNC_LABEL[n]).join(', ')}. Not synced: the game on the board, downloaded Chess.com/Lichess games, the Lichess token. If two devices changed the same data, lists are merged; other settings keep the newer version.</p>
          <div className="row wrap">
            <button className="btn primary" onClick={() => void syncNow(true)} disabled={s.busy !== 'idle'} data-testid="account-sync">{s.busy === 'syncing' ? 'Syncing…' : 'Sync now'}</button>
            <button className="btn" onClick={() => openDialog('account')} data-testid="settings-profile">View my profile</button>
            <button className="btn" onClick={() => void signOut()} data-testid="account-signout">Sign out</button>
          </div>
          <details className="fold">
            <summary>Delete my cloud data</summary>
            <p className="muted small-print">Removes the progress and settings this account stored in the cloud, and the numbers friends could see. Your username, picture and friends stay, and this device keeps its own copy.</p>
            <button className="btn danger" onClick={() => confirmThen(true, 'Delete everything stored in the cloud for this account? This device keeps its own copy.', 'Delete cloud data', () => void deleteMyCloudData())} data-testid="account-delete">Delete cloud data</button>
          </details>
          {s.error !== null && <div className="callout error small" role="alert" data-testid="account-error">{s.error}</div>}
        </section>
      </div>
    </fieldset>
  );
}

/** The sign-in / profile dialog. */
export function AccountDialog() {
  const s = useSync((x) => x);
  const needsName = s.userId !== null && s.profileLoaded && s.profile === null;
  const title = s.userId === null ? 'Sign in' : needsName ? 'Choose a username' : 'Your profile';
  return (
    <Modal title={title} onClose={closeDialog} wide={s.userId !== null && !needsName}>
      <div className="account-dialog" data-testid="account-dialog">
        {!s.configured ? (
          <p className="muted" data-testid="account-off">Cloud sync is not set up on this site, so everything stays in this browser.</p>
        ) : s.userId === null ? (
          <>
            <p className="lead">Keep your progress safe, pick up on any device and add friends.</p>
            <Benefits />
            <SignInForm />
          </>
        ) : needsName ? (
          <>
            <p className="lead">Welcome! Pick a unique username for your profile.</p>
            <p className="muted small-print">It is how friends find you. You can change it any time in Settings.</p>
            <UsernameForm first />
          </>
        ) : !s.profileLoaded ? (
          <p className="muted">Loading your profile…</p>
        ) : (
          <ProfileView />
        )}
        {s.error !== null && s.userId === null && <div className="callout error small" role="alert" data-testid="account-error">{s.error}</div>}
      </div>
    </Modal>
  );
}
