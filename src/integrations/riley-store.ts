import { createClient, SupabaseClient } from '@supabase/supabase-js';

export class RileyStore {
  private supabase: SupabaseClient | null;

  constructor(url: string | undefined, key: string | undefined) {
    this.supabase = url && key ? createClient(url, key) : null;
  }

  async recordSpace(spaceName: string, displayName: string | undefined): Promise<void> {
    if (!this.supabase || !spaceName) return;

    const now = new Date().toISOString();
    const { error } = await this.supabase.from('chat_spaces').upsert(
      {
        space_name: spaceName,
        display_name: displayName ?? null,
        client_key: displayName ? displayName.trim().toLowerCase() : null,
        last_seen_at: now,
      },
      { onConflict: 'space_name' }
    );

    if (error) {
      console.error('[RileyStore] Failed to record space:', error.message);
    }
  }
}

export const createRileyStore = (): RileyStore =>
  new RileyStore(process.env.RILEY_SUPABASE_URL, process.env.RILEY_SUPABASE_SERVICE_ROLE_KEY);
