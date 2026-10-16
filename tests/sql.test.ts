import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs supabase/schema.sql in a real Postgres (PGlite, WASM) with minimal stand-ins for Supabase's auth schema and roles,
 * and checks the row level security and the friend functions the way the website will use them.
 * This is Postgres, not Supabase itself: auth.uid() is a stub that reads a setting.
 */
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const db = new PGlite();

async function as(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user === null ? 'anon' : 'authenticated'};`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
  }
}
const fails = async (user: string | null, sql: string, params: unknown[] = []) => {
  try { await as(user, sql, params); return null; } catch (e) { return (e as Error).message; }
};

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    insert into auth.users values ('${A}'), ('${B}'), ('${C}');
  `);
  await db.exec(readFileSync('supabase/schema.sql', 'utf8'));
  await db.exec(`insert into public.profiles (user_id, username) values ('${A}', 'Alice'), ('${B}', 'Bob'), ('${C}', 'Carol')`);
});

describe('profiles', () => {
  it('lets users read only their own row', async () => {
    expect((await as(A, 'select username from public.profiles')).rows).toEqual([{ username: 'Alice' }]);
    expect((await as(null, 'select 1 from public.profiles').catch(() => ({ rows: [] }))).rows).toEqual([]);
  });
  it('rejects duplicate usernames ignoring case, bad characters and reserved names', async () => {
    expect(await fails(B, `update public.profiles set username = 'ALICE' where user_id = '${B}'`)).toMatch(/duplicate|unique/i);
    expect(await fails(B, `update public.profiles set username = 'a b' where user_id = '${B}'`)).toMatch(/check/i);
    expect(await fails(B, `update public.profiles set username = 'Admin' where user_id = '${B}'`)).toMatch(/check|reserved/i);
  });
  it('accepts only small jpeg data urls as avatar', async () => {
    expect(await fails(A, `update public.profiles set avatar = 'data:image/jpeg;base64,/9j/4AAQ' where user_id = '${A}'`)).toBeNull();
    expect(await fails(A, `update public.profiles set avatar = 'https://evil.example/x.png' where user_id = '${A}'`)).toMatch(/check/i);
    expect(await fails(A, `update public.profiles set avatar = 'data:image/svg+xml;base64,PHN2Zz4=' where user_id = '${A}'`)).toMatch(/check/i);
    expect(await fails(A, `update public.profiles set avatar = 'data:image/jpeg;base64,${'A'.repeat(60001)}' where user_id = '${A}'`)).toMatch(/check/i);
  });
  it('cannot change somebody else\'s profile', async () => {
    await as(B, `update public.profiles set username = 'Hacked' where user_id = '${A}'`);
    expect((await as(A, 'select username from public.profiles')).rows[0]).toEqual({ username: 'Alice' });
  });
});

describe('friends', () => {
  it('finds a user by exact name only, never yourself', async () => {
    expect((await as(A, `select username from public.search_user('bob')`)).rows).toEqual([{ username: 'Bob' }]);
    expect((await as(A, `select username from public.search_user('bo')`)).rows).toEqual([]);
    expect((await as(A, `select username from public.search_user('alice')`)).rows).toEqual([]);
    expect(await fails(null, `select * from public.search_user('bob')`)).toMatch(/permission/i);
  });
  it('cannot write friendships directly', async () => {
    expect(await fails(A, `insert into public.friendships (requester, addressee, status) values ('${A}', '${C}', 'accepted')`)).toMatch(/permission/i);
    expect(await fails(A, `update public.friendships set status = 'accepted'`)).toMatch(/permission/i);
    expect(await fails(A, `delete from public.friendships`)).toMatch(/permission/i);
  });
  it('request -> pending, only the addressee can accept', async () => {
    expect((await as(A, `select public.friend_request('${B}') r`)).rows[0]).toEqual({ r: 'pending' });
    expect((await as(A, `select public.friend_request('${B}') r`)).rows[0]).toEqual({ r: 'pending' }); // idempotent
    const incoming = (await as(B, 'select * from public.friends_overview()')).rows[0] as { friendship_id: string; incoming: boolean; username: string; stats: unknown };
    expect(incoming.incoming).toBe(true);
    expect(incoming.username).toBe('Alice');
    expect(await fails(A, `select public.friend_respond('${incoming.friendship_id}', true)`)).toMatch(/No such request/);
    expect(await fails(C, `select public.friend_respond('${incoming.friendship_id}', true)`)).toMatch(/No such request/);
    expect((await as(B, `select public.friend_respond('${incoming.friendship_id}', true) r`)).rows[0]).toEqual({ r: 'accepted' });
  });
  it('shows stats to accepted friends only, and only when published', async () => {
    await as(A, `insert into public.profile_stats (user_id, stats) values ('${A}', '{"games":3,"solved":7}')`);
    const row = (await as(B, 'select * from public.friends_overview()')).rows[0] as { stats: { games: number } | null; member_since: unknown };
    expect(row.stats?.games).toBe(3);
    expect(row.member_since).not.toBeNull();
    // a stranger cannot read the stats table, and a pending requester does not get them
    expect((await as(C, 'select * from public.profile_stats')).rows).toEqual([]);
    await as(C, `select public.friend_request('${A}')`);
    const pend = (await as(C, 'select * from public.friends_overview()')).rows[0] as { stats: unknown; member_since: unknown; status: string };
    expect(pend.status).toBe('pending');
    expect(pend.stats).toBeNull();
    expect(pend.member_since).toBeNull();
  });
  it('mutual requests become friends; rules and limits are enforced', async () => {
    await as(A, `select public.friend_remove(id) from public.friendships where status = 'pending'`);
    expect((await as(C, `select public.friend_request('${A}') r`)).rows[0]).toEqual({ r: 'pending' });
    expect((await as(A, `select public.friend_request('${C}') r`)).rows[0]).toEqual({ r: 'accepted' });
    expect(await fails(A, `select public.friend_request('${A}')`)).toMatch(/yourself/);
    expect(await fails(A, `select public.friend_request('00000000-0000-0000-0000-0000000000ff')`)).toMatch(/No such user/);
  });
  it('either side can remove, a stranger cannot', async () => {
    await db.exec(`insert into auth.users values ('00000000-0000-0000-0000-0000000000d1'); insert into public.profiles (user_id, username) values ('00000000-0000-0000-0000-0000000000d1', 'Dave')`);
    const D = '00000000-0000-0000-0000-0000000000d1';
    await as(D, `select public.friend_request('${B}')`);
    const id = ((await as(D, 'select * from public.friends_overview()')).rows[0] as { friendship_id: string }).friendship_id;
    await as(C, `select public.friend_remove('${id}')`);
    expect((await as(D, 'select * from public.friends_overview()')).rows.length).toBe(1);
    await as(B, `select public.friend_remove('${id}')`);
    expect((await as(D, 'select * from public.friends_overview()')).rows.length).toBe(0);
  });
  it('the 50 pending-request limit holds', async () => {
    for (let i = 0; i < 51; i += 1) {
      const id = `00000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`;
      await db.exec(`insert into auth.users values ('${id}'); insert into public.profiles (user_id, username) values ('${id}', 'user_${i}')`);
    }
    for (let i = 0; i < 50; i += 1) await as(B, `select public.friend_request('00000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}')`);
    expect(await fails(B, `select public.friend_request('00000000-0000-0000-0000-000000000150')`)).toMatch(/Too many/);
  });
});
