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

export const buildProposalText = (meetingTitle: string, items: ProposalItem[]): string => {
  const lines = items.map((item) => {
    const detail = item.task && item.task !== item.title ? ` - ${item.task}` : '';
    const assignee = item.assignee ? ` [${item.assignee}]` : '';
    const status = item.existing_task ? ` (possible match: "${item.existing_task}")` : ' (new)';
    return `${item.number}. *${item.title}*${detail}${assignee}${status}`;
  });

  return [
    `*Action items from "${meetingTitle}"*`,
    `Reply in this thread with the numbers to create in Donezy, e.g. \`yes 1,3\`. Expires in ${EXPIRY_HOURS} hours.`,
    '',
    ...lines,
  ].join('\n');
};

export class ProposalService {
  constructor(
    private store: RileyStore,
    private chat: GoogleChatIntegration,
    private donezy: DonezyIntegration
  ) {}

  async propose(candidate: MeetingCandidate): Promise<boolean> {
    if (candidate.actionItems.length === 0) return false;

    const useClientSpace = process.env.PROPOSAL_TARGET === 'client' && candidate.space_name;
    const target = useClientSpace ? candidate.space_name : process.env.GOOGLE_CHAT_SPACE_ID;
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

    const posted = await this.chat.postMessage(target, buildProposalText(candidate.title, items));
    if (!posted) return false;

    await this.store.saveProposal({
      vribble_meeting_id: candidate.vribble_meeting_id,
      title: candidate.title,
      space_name: target.startsWith('spaces/') ? target : `spaces/${target}`,
      message_name: posted.name,
      thread_name: posted.threadName ?? null,
      items,
      expires_at: new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000).toISOString(),
    });

    return true;
  }
}
