import { useEffect, useState } from 'react';
import { confirmThen } from '@/stores/uiStore';
import { findUser, loadFriends, removeFriend, requestFriend, respondFriend, useSync } from '@/sync/syncStore';
import { levelText, presenceOf, type Friend, type FoundUser, type FriendStats } from '@/sync/social';
import { Avatar } from './Avatar';

function dateText(ms: number | null): string | null {
  return ms === null || ms <= 0 ? null : new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function StatTiles({ stats, own }: { stats: FriendStats | null; own?: boolean }) {
  if (stats === null) return <p className="muted small-print" data-testid="stats-hidden">{own ? 'Nothing to show yet.' : 'This friend has not shared any numbers.'}</p>;
  return (
    <div className="stat-grid" data-testid="profile-stats">
      <div className="stat-tile"><strong>{levelText(stats)}</strong><span>Estimated level</span><small>{stats.level === null ? 'needs analysed games' : 'rough estimate'}</small></div>
      <div className="stat-tile"><strong>{stats.games}</strong><span>Analysed games</span></div>
      <div className="stat-tile"><strong>{stats.solved}</strong><span>Puzzles solved</span></div>
      <div className="stat-tile"><strong>{stats.bestStreak}</strong><span>Best puzzle streak</span></div>
    </div>
  );
}

export function FriendProfile({ friend, onBack }: { friend: Friend; onBack: () => void }) {
  const since = dateText(friend.memberSince);
  return (
    <div className="friend-profile" data-testid="friend-profile">
      <button className="linklike" onClick={onBack} data-testid="friend-back">← Back to friends</button>
      <div className="account-card">
        <Avatar name={friend.username} src={friend.avatar} size={64} online={presenceOf(friend).online} />
        <div>
          <div className="profile-name" data-testid="friend-profile-name">{friend.username}</div>
          <div className={`small-print ${presenceOf(friend).online ? 'online-text' : 'muted'}`} data-testid="friend-presence">{presenceOf(friend).label}</div>
          <div className="muted small-print">{since !== null ? `Member since ${since}` : 'Friend'}</div>
        </div>
      </div>
      <StatTiles stats={friend.stats} />
      <button className="btn danger" onClick={() => confirmThen(true, `Remove ${friend.username} from your friends?`, 'Remove friend', () => { void removeFriend(friend.friendshipId).then(onBack); })} data-testid="friend-remove">Remove friend</button>
    </div>
  );
}

function AddFriend() {
  const [name, setName] = useState('');
  const [found, setFound] = useState<FoundUser | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const friends = useSync((s) => s.friends);
  const existing = found !== null ? friends?.find((f) => f.userId === found.userId) : undefined;

  const search = () => {
    const n = name.trim();
    if (n === '') return;
    setBusy(true); setFound(null); setMsg(null);
    void findUser(n).then((r) => {
      setBusy(false);
      if (r.error !== null) setMsg(r.error);
      else if (r.user === null) setMsg(`Nobody is called "${n}". Usernames must be spelled exactly (capital letters do not matter).`);
      else setFound(r.user);
    });
  };
  const add = () => {
    if (found === null) return;
    setBusy(true);
    void requestFriend(found.userId).then((r) => {
      setBusy(false);
      if (r.error !== null) setMsg(r.error);
      else setMsg(r.result === 'accepted' ? `You and ${found.username} are now friends.` : r.result === 'friends' ? 'You are already friends.' : `Request sent to ${found.username}.`);
    });
  };
  return (
    <div className="add-friend">
      <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input value={name} onChange={(e) => setName(e.target.value.trim())} placeholder="Friend's username" aria-label="Friend's username" maxLength={20} autoComplete="off" spellCheck={false} data-testid="friend-search" />
        <button className="btn" type="submit" disabled={busy || name === ''} data-testid="friend-find">Find</button>
      </form>
      {found !== null && (
        <div className="friend-row found" data-testid="friend-found">
          <Avatar name={found.username} src={found.avatar} size={36} />
          <strong>{found.username}</strong>
          <span className="spacer" />
          {existing !== undefined ? <span className="muted small-print">{existing.status === 'accepted' ? 'Already friends' : existing.incoming ? 'Sent you a request (see below)' : 'Request sent'}</span>
            : <button className="btn primary small" onClick={add} disabled={busy} data-testid="friend-add">Add friend</button>}
        </div>
      )}
      {msg !== null && <div className="muted small-print" role="status" data-testid="friend-msg">{msg}</div>}
    </div>
  );
}

/** Friends: find by exact username, requests, friend list, friend profiles. */
export function FriendsPanel({ onOpen }: { onOpen: (friendshipId: string) => void }) {
  const friends = useSync((s) => s.friends);
  useEffect(() => {
    void loadFriends();
    const t = setInterval(() => void loadFriends(), 60_000);
    return () => clearInterval(t);
  }, []);


  const incoming = (friends ?? []).filter((f) => f.status === 'pending' && f.incoming);
  const sent = (friends ?? []).filter((f) => f.status === 'pending' && !f.incoming);
  const accepted = (friends ?? []).filter((f) => f.status === 'accepted').sort((a, b) => Number(presenceOf(b).online) - Number(presenceOf(a).online) || a.username.localeCompare(b.username));
  return (
    <div className="friends" data-testid="friends">
      <AddFriend />
      {friends === null && <p className="muted small-print">Loading friends…</p>}
      {incoming.length > 0 && (
        <div data-testid="friend-requests">
          <h4>Requests ({incoming.length})</h4>
          {incoming.map((f) => (
            <div key={f.friendshipId} className="friend-row">
              <Avatar name={f.username} src={f.avatar} size={36} />
              <strong>{f.username}</strong>
              <span className="spacer" />
              <button className="btn primary small" onClick={() => void respondFriend(f.friendshipId, true)} data-testid="friend-accept">Accept</button>
              <button className="btn small" onClick={() => void respondFriend(f.friendshipId, false)} data-testid="friend-decline">Decline</button>
            </div>
          ))}
        </div>
      )}
      <h4>Friends{accepted.length > 0 ? ` (${accepted.length})` : ''}</h4>
      {friends !== null && accepted.length === 0 && <p className="muted small-print" data-testid="no-friends">No friends yet. Ask a friend for their username and add them above.</p>}
      {accepted.map((f) => (
        <button key={f.friendshipId} className="friend-row clickable" onClick={() => onOpen(f.friendshipId)} data-testid="friend-item">
          <Avatar name={f.username} src={f.avatar} size={36} online={presenceOf(f).online} />
          <span className="friend-main"><strong>{f.username}</strong><small className={presenceOf(f).online ? 'online-text' : 'muted'} data-testid="friend-status">{presenceOf(f).label}</small></span>
          <span className="spacer" />
          <span className="muted small-print">{f.stats === null ? '' : `level ${levelText(f.stats)}`}</span>
          <span aria-hidden>›</span>
        </button>
      ))}
      {sent.length > 0 && (
        <div data-testid="friend-sent">
          <h4>Sent requests</h4>
          {sent.map((f) => (
            <div key={f.friendshipId} className="friend-row">
              <Avatar name={f.username} src={f.avatar} size={36} />
              <strong>{f.username}</strong>
              <span className="spacer" />
              <span className="muted small-print">waiting…</span>
              <button className="btn small" onClick={() => void removeFriend(f.friendshipId)} data-testid="friend-cancel">Cancel</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
