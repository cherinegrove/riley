import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ChatSpace, ProcessedMeeting, RileyStore } from '../integrations/riley-store';

const DEFAULT_DURATION_MINUTES = 60;
const LOOKBACK_DAYS = 3;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
const INTERNAL_DOMAINS = ['cybersolve.net'];

export interface ParsedActionItem {
  title: string;
  task: string;
  assignee: string | null;
}

export interface MeetingCandidate extends ProcessedMeeting {
  actionItems: ParsedActionItem[];
}

type MeetingRow = {
  id: string;
  title: string;
  meeting_date: string;
  duration_minutes: number | null;
  attendees: string[] | null;
  action_items: string[] | null;
};

export const parseActionItems = (raw: string[]): ParsedActionItem[] =>
  raw.map((item) => {
    try {
      const parsed = JSON.parse(item);
      return {
        title: parsed.title || parsed.task || item,
        task: parsed.task || parsed.title || item,
        assignee: parsed.assignee || null,
      };
    } catch {
      return { title: item, task: item, assignee: null };
    }
  });

export const matchClient = (
  attendees: string[] | null,
  spaces: ChatSpace[]
): { status: 'detected' | 'no_client' | 'ambiguous_client'; space: ChatSpace | null } => {
  const domains = (attendees || [])
    .map((email) => email.split('@')[1]?.toLowerCase())
    .filter((domain): domain is string => !!domain && !INTERNAL_DOMAINS.includes(domain));

  for (const domain of domains) {
    const stem = domain.split('.')[0];
    const exact = spaces.filter((space) => space.client_key === stem);
    if (exact.length === 1) return { status: 'detected', space: exact[0] };

    const partial = spaces.filter((space) => space.client_key && space.client_key.includes(stem));
    if (partial.length === 1) return { status: 'detected', space: partial[0] };
    if (partial.length > 1) return { status: 'ambiguous_client', space: null };
  }

  return { status: 'no_client', space: null };
};

export class MeetingTrigger {
  private vribble: SupabaseClient | null;

  constructor(
    vribbleUrl: string | undefined,
    vribbleKey: string | undefined,
    private store: RileyStore,
    private onDetected?: (candidate: MeetingCandidate) => Promise<unknown>
  ) {
    this.vribble = vribbleUrl && vribbleKey ? createClient(vribbleUrl, vribbleKey) : null;
  }

  async scan(now: Date = new Date(), record = true): Promise<MeetingCandidate[]> {
    if (!this.vribble) return [];

    const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.vribble
      .from('meetings')
      .select('id, title, meeting_date, duration_minutes, attendees, action_items')
      .not('action_items', 'is', null)
      .gte('meeting_date', since)
      .order('meeting_date', { ascending: true });

    if (error) {
      console.error('[MeetingTrigger] Failed to read Vribble meetings:', error.message);
      return [];
    }

    const ended = ((data || []) as MeetingRow[])
      .filter((meeting) => (meeting.action_items?.length || 0) > 0)
      .map((meeting) => {
        const start = new Date(meeting.meeting_date);
        const end = new Date(start.getTime() + (meeting.duration_minutes ?? DEFAULT_DURATION_MINUTES) * 60 * 1000);
        return { meeting, start, end };
      })
      .filter(({ end }) => end <= now);

    const alreadyProcessed = await this.store.processedMeetingIds(ended.map(({ meeting }) => meeting.id));
    const spaces = await this.store.listSpaces();
    const kept: Array<{ title: string; start: number }> = [];
    const candidates: MeetingCandidate[] = [];

    for (const { meeting, start, end } of ended) {
      if (alreadyProcessed.has(meeting.id)) continue;

      const isDuplicate = kept.some(
        (k) => k.title === meeting.title && Math.abs(k.start - start.getTime()) < DUPLICATE_WINDOW_MS
      );

      let status: string;
      let space: ChatSpace | null = null;
      if (isDuplicate) {
        status = 'duplicate';
      } else {
        kept.push({ title: meeting.title, start: start.getTime() });
        const match = matchClient(meeting.attendees, spaces);
        status = match.status;
        space = match.space;
      }

      const candidate: MeetingCandidate = {
        vribble_meeting_id: meeting.id,
        title: meeting.title,
        meeting_end_at: end.toISOString(),
        client_key: space?.client_key ?? null,
        space_name: space?.space_name ?? null,
        status,
        actionItems: parseActionItems(meeting.action_items || []),
      };

      if (record) {
        await this.store.recordMeeting({
          vribble_meeting_id: candidate.vribble_meeting_id,
          title: candidate.title,
          meeting_end_at: candidate.meeting_end_at,
          client_key: candidate.client_key,
          space_name: candidate.space_name,
          status: candidate.status,
        });
        if (candidate.status !== 'duplicate' && this.onDetected) {
          await this.onDetected(candidate);
        }
      }

      candidates.push(candidate);
    }

    return candidates;
  }

  async candidateFor(meetingId: string): Promise<MeetingCandidate | null> {
    if (!this.vribble) return null;

    const { data, error } = await this.vribble
      .from('meetings')
      .select('id, title, meeting_date, duration_minutes, attendees, action_items')
      .eq('id', meetingId)
      .single();
    if (error || !data) return null;

    const meeting = data as MeetingRow;
    const start = new Date(meeting.meeting_date);
    const end = new Date(start.getTime() + (meeting.duration_minutes ?? DEFAULT_DURATION_MINUTES) * 60 * 1000);
    const match = matchClient(meeting.attendees, await this.store.listSpaces());

    return {
      vribble_meeting_id: meeting.id,
      title: meeting.title,
      meeting_end_at: end.toISOString(),
      client_key: match.space?.client_key ?? null,
      space_name: match.space?.space_name ?? null,
      status: match.status,
      actionItems: parseActionItems(meeting.action_items || []),
    };
  }

  start(intervalMs: number): void {
    setInterval(() => {
      this.scan()
        .then((candidates) => {
          if (candidates.length > 0) {
            console.log(`[MeetingTrigger] Recorded ${candidates.length} finished meeting(s)`);
          }
        })
        .catch((error) => console.error('[MeetingTrigger] Scan failed:', error));
    }, intervalMs);
    console.log(`[MeetingTrigger] Scanning Vribble every ${Math.round(intervalMs / 60000)} minutes`);
  }
}
