import { HubSpotIntegration } from '../integrations/hubspot';
import { ChatSpace, ProcessedMeeting, RileyStore } from '../integrations/riley-store';
import { bestMatch } from '../integrations/donezy';

const LOOKBACK_DAYS = 3;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

export interface ParsedActionItem {
  title: string;
  task: string;
  assignee: string | null;
}

export interface MeetingCandidate extends ProcessedMeeting {
  actionItems: ParsedActionItem[];
  attendees: string[];
}

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

export const matchClientByCompany = (
  companyName: string | null,
  spaces: ChatSpace[]
): { status: 'detected' | 'no_client'; space: ChatSpace | null } => {
  if (!companyName) return { status: 'no_client', space: null };
  const match = bestMatch(companyName, spaces.filter((s) => s.client_key).map((s) => ({ item: s, name: s.client_key as string })));
  return match ? { status: 'detected', space: match.item } : { status: 'no_client', space: null };
};

export const matchByTitle = (
  title: string,
  aliases: Array<{ keyword: string; client_key: string }>,
  spaces: ChatSpace[]
): { status: 'detected'; space: ChatSpace } | null => {
  const lowerTitle = title.toLowerCase();
  const sorted = [...aliases].sort((a, b) => b.keyword.length - a.keyword.length);
  for (const alias of sorted) {
    if (!lowerTitle.includes(alias.keyword.toLowerCase())) continue;
    const space = spaces.find((s) => s.client_key === alias.client_key);
    if (space) return { status: 'detected', space };
  }
  return null;
};

const resolveClient = async (
  title: string,
  companyName: string | null,
  store: RileyStore
): Promise<{ status: 'detected' | 'no_client'; space: ChatSpace | null }> => {
  const spaces = await store.listSpaces();
  const byCompany = matchClientByCompany(companyName, spaces);
  if (byCompany.status === 'detected') return byCompany;
  const byTitle = matchByTitle(title, await store.listTitleAliases(), spaces);
  return byTitle ?? byCompany;
};

export class MeetingTrigger {
  constructor(
    private hubspot: HubSpotIntegration,
    private store: RileyStore,
    private onDetected?: (candidate: MeetingCandidate) => Promise<unknown>
  ) {}

  async scan(now: Date = new Date(), record = true): Promise<MeetingCandidate[]> {
    const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    let meetings: Awaited<ReturnType<HubSpotIntegration['getEndedMeetings']>>;
    try {
      meetings = await this.hubspot.getEndedMeetings(since, now.toISOString());
    } catch (error) {
      console.error('[MeetingTrigger] Failed to read HubSpot meetings:', error);
      return [];
    }

    const withActions = meetings.filter((m) => m.actionItems.length > 0);
    const alreadyProcessed = await this.store.processedMeetingIds(withActions.map((m) => m.id));
    const kept: Array<{ title: string; start: number }> = [];
    const candidates: MeetingCandidate[] = [];

    for (const meeting of withActions) {
      if (alreadyProcessed.has(meeting.id)) continue;

      const end = new Date(meeting.endAt);
      const start = end.getTime();
      const isDuplicate = kept.some((k) => k.title === meeting.title && Math.abs(k.start - start) < DUPLICATE_WINDOW_MS);

      let status: string;
      let space: ChatSpace | null = null;
      if (isDuplicate) {
        status = 'duplicate';
      } else {
        kept.push({ title: meeting.title, start });
        const match = await resolveClient(meeting.title, meeting.companyName, this.store);
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
        actionItems: parseActionItems(meeting.actionItems),
        attendees: [],
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
    const candidates = await this.scan(new Date(), false);
    return candidates.find((c) => c.vribble_meeting_id === meetingId) ?? null;
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
    console.log(`[MeetingTrigger] Scanning HubSpot every ${Math.round(intervalMs / 60000)} minutes`);
  }
}
