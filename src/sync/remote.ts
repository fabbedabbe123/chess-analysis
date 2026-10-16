import type { SupabaseClient } from '@supabase/supabase-js';
import type { Remote, RemoteRow } from './engine';

const TABLE = 'user_data';

/** The cloud side: one row per (user, name) in `public.user_data`, protected by row level security (see supabase/schema.sql). */
export function supabaseRemote(client: SupabaseClient, userId: string): Remote {
  return {
    async fetchAll(): Promise<RemoteRow[]> {
      const { data, error } = await client.from(TABLE).select('name,value,updated_at');
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: { name: string; value: string; updated_at: string }) => ({ name: r.name, value: r.value, updatedAt: Date.parse(r.updated_at) || 0 }));
    },
    async upsert(rows): Promise<void> {
      const { error } = await client.from(TABLE).upsert(rows.map((r) => ({ user_id: userId, name: r.name, value: r.value })), { onConflict: 'user_id,name' });
      if (error) throw new Error(error.message);
    },
  };
}

export async function deleteCloudData(client: SupabaseClient, userId: string): Promise<void> {
  const { error } = await client.from(TABLE).delete().eq('user_id', userId);
  if (error) throw new Error(error.message);
}
