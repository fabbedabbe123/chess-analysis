/** Cloud sync is optional: it is only active when the site was built with a Supabase project's URL and public (anon) key. */
export interface SyncConfig { url: string; anonKey: string }

export function syncConfig(env: Record<string, unknown> = import.meta.env as Record<string, unknown>): SyncConfig | null {
  const url = env['VITE_SUPABASE_URL'];
  const anonKey = env['VITE_SUPABASE_ANON_KEY'];
  if (typeof url !== 'string' || typeof anonKey !== 'string') return null;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(url.trim()) || anonKey.trim().length < 20) return null;
  return { url: url.trim().replace(/\/$/, ''), anonKey: anonKey.trim() };
}
