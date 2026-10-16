import { DonezyIntegration } from '../integrations/donezy';
import { GoogleChatIntegration } from '../integrations/google-chat';
import { RileyStore } from '../integrations/riley-store';
import { DonezyTask } from '../utils/types';
import { MeetingCandidate } from './meeting-trigger';

const EXPIRY_HOURS = 48;
const MIN_MATCH_LENGTH = 6;

export interface ProposalItem {
  number: number;
  title: string;
  task: string;
  assignee: string | null;
  existing_task: string | null;
}

export const findExistingTask = (title: string, openTasks: DonezyTask[]): DonezyTask | null => {
  const wanted = title.trim().toLowerCase();
  if (wanted.length < MIN_MATCH_LENGTH) return null;

  return (
    openTasks.find((task) => {
      const existing = task.title.trim().toLowerCase();
      return existing.length >= MIN_MATCH_LENGTH && (existing.includes(wanted) || wanted.includes(existing));
    }) || null
  );
};

export const buildProposalText = (
  meetingTitle: string,
  items: ProposalItem[],
  clientMatched: boolean,
  clientName: string | null,
  attendeeTags: string[]
): string => {
  const lines = items.map((item) => {
    const detail = item.task && item.task !== item.title ? ` - ${item.task}` : '';
    const assignee = item.assignee ? ` [${item.assignee}]` : '';
    const status = item.existing_task ? ` (possible match: "${item.existing_task}")` : ' (new)';
    return `${item.number}. *${item.title}*${detail}${assignee}${status}`;
  });

  const heading = clientMatched && clientName
    ? `*Action Items for ${clientName}*\nMeeting: "${meetingTitle}"`
    : `*Action Items from "${meetingTitle}"*`;
  const attendees = attendeeTags.length > 0 ? [`Attendees: ${attendeeTags.join(' ')}`] : [];
  const body = clientMatched
    ? `Items marked (new) are not in Donezy yet. Please reply in this thread with the numbers to create, e.g. \`yes 1,3\`. Expires in ${EXPIRY_HOURS} hours.`
    : `I couldn't match this meeting to a client, so please tell me which one it belongs to.\nReply \`client <name>\` in this thread (e.g. \`client Sourcefin\`), then reply with the numbers to create, e.g. \`yes 1,3\`. Expires in ${EXPIRY_HOURS} hours.`;

  return [heading, ...attendees, '', body, '', ...lines, ''].join('\n');
};

export class ProposalService {
  constructor(
    private store: RileyStore,
    private chat: GoogleChatIntegration,
    private donezy: DonezyIntegration
  ) {}

  async propose(candidate: MeetingCandidate): Promise<boolean> {
    if (candidate.actionItems.length === 0) return false;

    const clientMatched = candidate.status === 'detected' && !!candidate.space_name;
    const useClientSpace = clientMatched && process.env.PROPOSAL_TARGET === 'client';
    const target = useClientSpace
      ? candidate.space_name
      : process.env.PROPOSAL_FALLBACK_SPACE || process.env.GOOGLE_CHAT_SPACE_ID;
    if (!target) {
      console.error('[Proposals] No target space configured');
      return false;
    }

    const openTasks = await this.donezy.getAllTasks();
    const items: ProposalItem[] = candidate.actionItems.map((item, index) => ({
      number: index + 1,
      title: item.title,
      task: item.task,
      assignee: item.assignee,
      existing_task: findExistingTask(item.title, openTasks)?.title ?? null,
    }));

    const spaces = await this.store.listSpaces();
    const clientName = clientMatched
      ? spaces.find((s) => s.space_name === candidate.space_name)?.display_name ?? candidate.client_key
      : null;
    const chatUsers = await this.store.chatUsersByEmail(candidate.attendees);
    const attendeeTags = candidate.attendees
      .map((email) => chatUsers.get(email.toLowerCase())?.user_name)
      .filter((name): name is string => !!name)
      .map((name) => `<${name}>`);

    const posted = await this.chat.postMessage(
      target,
      buildProposalText(candidate.title, items, clientMatched, clientName, attendeeTags)
    );
    if (!posted) return false;

    await this.store.saveProposal({
      vribble_meeting_id: candidate.vribble_meeting_id,
      title: candidate.title,
      space_name: target.startsWith('spaces/') ? target : `spaces/${target}`,
      message_name: posted.name,
      thread_name: posted.threadName ?? null,
      items,
      expires_at: new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000).toISOString(),
      client_key: clientMatched ? candidate.client_key : null,
    });

    return true;
  }
}
