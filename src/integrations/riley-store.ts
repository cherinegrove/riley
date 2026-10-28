import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface ChatSpace {
  space_name: string;
  display_name: string | null;
  client_key: string | null;
}

export interface ProcessedMeeting {
  vribble_meeting_id: string;
  title: string;
  meeting_end_at: string;
  client_key: string | null;
  space_name: string | null;
  status: string;
}

export interface PendingProposal {
  id: string;
  vribble_meeting_id: string;
  title: string;
  space_name: string;
  thread_name: string | null;
  items: Array<{ number: number; title: string; task: string; assignee: string | null; existing_task: string | null }>;
  status: string;
  expires_at: string;
  created_numbers: number[];
  client_key: string | null;
}

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

  async recordChatUser(userName: string, email: string, displayName: string | undefined): Promise<void> {
    if (!this.supabase || !userName || !email) return;
    const { error } = await this.supabase.from('chat_users').upsert(
      {
        user_name: userName,
        email: email.toLowerCase(),
        display_name: displayName ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_name' }
    );
    if (error) {
      console.error('[RileyStore] Failed to record chat user:', error.message);
    }
  }

  async chatUsersByEmail(emails: string[]): Promise<Map<string, { user_name: string; display_name: string | null }>> {
    const found = new Map<string, { user_name: string; display_name: string | null }>();
    if (!this.supabase || emails.length === 0) return found;
    const { data, error } = await this.supabase
      .from('chat_users')
      .select('user_name, email, display_name')
      .in('email', emails.map((e) => e.toLowerCase()));
    if (error) {
      console.error('[RileyStore] Failed to look up chat users:', error.message);
      return found;
    }
    for (const row of (data || []) as Array<{ user_name: string; email: string; display_name: string | null }>) {
      found.set(row.email, { user_name: row.user_name, display_name: row.display_name });
    }
    return found;
  }

  async addThreadTurn(threadName: string, role: 'user' | 'assistant', text: string): Promise<void> {
    if (!this.supabase || !threadName) return;
    const { error } = await this.supabase.from('chat_thread_turns').insert({ thread_name: threadName, role, text: text.slice(0, 4000) });
    if (error) console.error('[RileyStore] Failed to save thread turn:', error.message);
  }

  async recentThreadTurns(threadName: string, limit = 10): Promise<Array<{ role: string; text: string }>> {
    if (!this.supabase || !threadName) return [];
    const { data, error } = await this.supabase
      .from('chat_thread_turns')
      .select('role, text')
      .eq('thread_name', threadName)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('[RileyStore] Failed to read thread turns:', error.message);
      return [];
    }
    return ((data || []) as Array<{ role: string; text: string }>).reverse();
  }

  async listSpaces(): Promise<ChatSpace[]> {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase.from('chat_spaces').select('space_name, display_name, client_key');
    if (error) {
      console.error('[RileyStore] Failed to list spaces:', error.message);
      return [];
    }
    return data || [];
  }

  async listTitleAliases(): Promise<Array<{ keyword: string; client_key: string }>> {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase.from('meeting_title_aliases').select('keyword, client_key');
    if (error) {
      console.error('[RileyStore] Failed to list title aliases:', error.message);
      return [];
    }
    return data || [];
  }

  async processedMeetingIds(ids: string[]): Promise<Set<string>> {
    if (!this.supabase || ids.length === 0) return new Set();
    const { data, error } = await this.supabase.from('processed_meetings').select('vribble_meeting_id').in('vribble_meeting_id', ids);
    if (error) {
      console.error('[RileyStore] Failed to read processed meetings:', error.message);
      return new Set(ids);
    }
    return new Set((data || []).map((row: { vribble_meeting_id: string }) => row.vribble_meeting_id));
  }

  async setProposalClient(id: string, clientKey: string): Promise<void> {
    if (!this.supabase) return;
    const { error } = await this.supabase.from('meeting_proposals').update({ client_key: clientKey }).eq('id', id);
    if (error) {
      console.error('[RileyStore] Failed to set proposal client:', error.message);
    }
  }

  async saveProposal(proposal: {
    vribble_meeting_id: string;
    title: string;
    space_name: string;
    message_name: string | null;
    thread_name: string | null;
    items: unknown[];
    expires_at: string;
    client_key: string | null;
  }): Promise<void> {
    if (!this.supabase) return;
    const { error } = await this.supabase.from('meeting_proposals').upsert(proposal, { onConflict: 'vribble_meeting_id' });
    if (error) {
      console.error('[RileyStore] Failed to save proposal:', error.message);
    }
  }

  async findPendingProposal(spaceName: string, threadName: string | undefined): Promise<PendingProposal | null> {
    if (!this.supabase) return null;

    if (threadName) {
      const { data } = await this.supabase
        .from('meeting_proposals')
        .select('*')
        .eq('space_name', spaceName)
        .eq('thread_name', threadName)
        .eq('status', 'pending')
        .limit(1);
      if (data && data.length > 0) return data[0];
    }

    const { data, error } = await this.supabase
      .from('meeting_proposals')
      .select('*')
      .eq('space_name', spaceName)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      console.error('[RileyStore] Failed to find proposal:', error.message);
      return null;
    }
    return data && data.length > 0 ? data[0] : null;
  }

  async recordCreatedItems(id: string, createdNumbers: number[], status: string): Promise<void> {
    if (!this.supabase) return;
    const { error } = await this.supabase
      .from('meeting_proposals')
      .update({ created_numbers: createdNumbers, status })
      .eq('id', id);
    if (error) {
      console.error('[RileyStore] Failed to record created items:', error.message);
    }
  }

  async updateProposalStatus(id: string, status: string): Promise<void> {
    if (!this.supabase) return;
    const { error } = await this.supabase.from('meeting_proposals').update({ status }).eq('id', id);
    if (error) {
      console.error('[RileyStore] Failed to update proposal:', error.message);
    }
  }

  async clientKeyForSpace(spaceName: string): Promise<string | null> {
    if (!this.supabase) return null;
    const { data } = await this.supabase.from('chat_spaces').select('client_key').eq('space_name', spaceName).limit(1);
    return data && data.length > 0 ? data[0].client_key : null;
  }

  async recordMeeting(meeting: ProcessedMeeting): Promise<void> {
    if (!this.supabase) return;
    const { error } = await this.supabase.from('processed_meetings').upsert(meeting, { onConflict: 'vribble_meeting_id' });
    if (error) {
      console.error('[RileyStore] Failed to record meeting:', error.message);
    }
  }
}

export const createRileyStore = (): RileyStore =>
  new RileyStore(process.env.RILEY_SUPABASE_URL, process.env.RILEY_SUPABASE_SERVICE_ROLE_KEY);
