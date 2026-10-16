import { useState } from 'react';
import { confirmThen } from '@/stores/uiStore';
import { SYNC_LABEL, SYNC_NAMES } from '@/sync/keys';
import { deleteMyCloudData, sendLink, signOut, syncNow, useSync } from '@/sync/syncStore';

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

/** Optional account: sign in with an e-mail link to keep your data in the cloud and use it on several devices. */
export function AccountSection() {
  const s = useSync((x) => x);
  const [email, setEmail] = useState('');

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
      <legend>Account (optional)</legend>
      {s.userId === null ? (
        <>
          <p className="muted small-print">Sign in to keep your progress in the cloud and use it on other devices. No password: you get a sign-in link by e-mail. Without signing in, everything stays in this browser only.</p>
          {s.linkSentTo !== null ? (
            <div className="callout small" role="status" data-testid="account-link-sent">A sign-in link was sent to {s.linkSentTo}. Open it on this device (check spam too).</div>
          ) : (
            <form className="row" onSubmit={(e) => { e.preventDefault(); void sendLink(email); }}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="E-mail address" autoComplete="email" data-testid="account-email" />
              <button className="btn primary" type="submit" disabled={s.busy !== 'idle' || email.trim() === ''} data-testid="account-send">{s.busy === 'sending' ? 'Sending…' : 'Send link'}</button>
            </form>
          )}
        </>
      ) : (
        <>
          <p data-testid="account-status">Signed in as <strong>{s.email ?? 'your account'}</strong>{s.lastSync !== null && <span className="muted"> · synced {ago(s.lastSync)}</span>}</p>
          <p className="muted small-print">Synced between devices: {SYNC_NAMES.map((n) => SYNC_LABEL[n]).join(', ')}. Not synced: the game on the board, downloaded Chess.com/Lichess games, the Lichess token. If both devices changed the same data, lists are merged; other settings keep the newer version.</p>
          <div className="row wrap">
            <button className="btn" onClick={() => void syncNow(true)} disabled={s.busy !== 'idle'} data-testid="account-sync">{s.busy === 'syncing' ? 'Syncing…' : 'Sync now'}</button>
            <button className="btn" onClick={() => void signOut()} data-testid="account-signout">Sign out</button>
            <button className="btn danger" onClick={() => confirmThen(true, 'Delete everything stored in the cloud for this account? This device keeps its own copy.', 'Delete cloud data', () => void deleteMyCloudData())} data-testid="account-delete">Delete cloud data</button>
          </div>
        </>
      )}
      {s.error !== null && <div className="callout error small" role="alert" data-testid="account-error">{s.error}</div>}
    </fieldset>
  );
}
