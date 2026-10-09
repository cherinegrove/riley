import { DonezyIntegration } from '../integrations/donezy';
import { PendingProposal, RileyStore } from '../integrations/riley-store';

const APPROVER_EMAIL = 'cherine@cybersolve.net';
const CREATOR_DONEZY_USER_ID = 'c5186049-990e-43c5-847a-c5bf0bc46220';

export type ReplyCommand = { kind: 'decline' } | { kind: 'approve'; numbers: number[] | 'all' };

export const parseReply = (text: string): ReplyCommand | null => {
  const cleaned = text.replace(/@riley\b/i, '').trim();

  if (/^no$/i.test(cleaned)) return { kind: 'decline' };

  const match = cleaned.match(/^yes\b\s*(.*)$/i);
  if (!match) return null;

  const rest = match[1].trim().toLowerCase();
  if (rest === 'all') return { kind: 'approve', numbers: 'all' };
  if (rest === '') return { kind: 'approve', numbers: [] };

  const numbers = rest.split(/[\s,]+/).map(Number);
  if (numbers.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  return { kind: 'approve', numbers };
};

export class ApprovalService {
  constructor(private store: RileyStore, private donezy: DonezyIntegration) {}

  async handle(text: string, spaceName: string, threadName: string | undefined, senderEmail: string | undefined): Promise<string | null> {
    const command = parseReply(text);
    if (!command) return null;

    const proposal = await this.store.findPendingProposal(spaceName, threadName);
    if (!proposal) return null;

    if (senderEmail?.toLowerCase() !== APPROVER_EMAIL) {
      return 'Only Cherine can approve tasks for this proposal.';
    }

    if (new Date(proposal.expires_at) < new Date()) {
      await this.store.updateProposalStatus(proposal.id, 'expired');
      return `This proposal for "${proposal.title}" has expired. Ask me to re-run the meeting check to get a new one.`;
    }

    if (command.kind === 'decline') {
      await this.store.updateProposalStatus(proposal.id, 'declined');
      return `Skipped the remaining action items from "${proposal.title}".`;
    }

    if (command.numbers !== 'all' && command.numbers.length === 0) {
      return 'Reply with the numbers to create, e.g. `yes 1,3`, or `yes all`.';
    }

    const validNumbers = proposal.items.map((item) => item.number);
    if (command.numbers !== 'all') {
      const unknown = command.numbers.filter((n) => !validNumbers.includes(n));
      if (unknown.length > 0) {
        return `There is no item ${unknown.join(', ')} in this proposal. Items are numbered 1 to ${validNumbers.length}.`;
      }
    }

    const requested = command.numbers === 'all' ? validNumbers : command.numbers;
    const alreadyCreated = requested.filter((n) => proposal.created_numbers.includes(n));
    const chosen = proposal.items.filter(
      (item) => requested.includes(item.number) && !proposal.created_numbers.includes(item.number)
    );

    if (chosen.length === 0) {
      return `Item${alreadyCreated.length === 1 ? '' : 's'} ${alreadyCreated.join(', ')} ${alreadyCreated.length === 1 ? 'is' : 'are'} already in Donezy.`;
    }

    const clientKey = await this.store.clientKeyForSpace(spaceName);
    if (!clientKey) {
      return "I can't create these tasks: this space isn't linked to a client.";
    }

    const project = await this.donezy.findOpenProjectForClient(clientKey);
    if ('error' in project) {
      return `I can't create these tasks yet: ${project.error}.`;
    }

    return this.createTasks(proposal, chosen, project.id);
  }

  private async createTasks(
    proposal: PendingProposal,
    items: PendingProposal['items'],
    projectId: string
  ): Promise<string> {
    const created: string[] = [];
    const createdNumbers: number[] = [];
    const failed: string[] = [];

    for (const item of items) {
      try {
        const assigneeId = item.assignee ? await this.donezy.getAssigneeIdByName(item.assignee) : null;
        await this.donezy.createTask({
          title: item.title,
          description: `${item.task}\n\nFrom meeting: ${proposal.title}`,
          project_id: projectId,
          creator_id: CREATOR_DONEZY_USER_ID,
          assignee_id: assigneeId,
        });
        created.push(item.title);
        createdNumbers.push(item.number);
      } catch (error) {
        failed.push(`${item.title} (${error instanceof Error ? error.message : String(error)})`);
      }
    }

    const allCreated = [...proposal.created_numbers, ...createdNumbers];
    const allItemsDone = proposal.items.every((item) => allCreated.includes(item.number));
    await this.store.recordCreatedItems(proposal.id, allCreated, allItemsDone ? 'completed' : 'pending');

    const lines: string[] = [];
    if (created.length > 0) lines.push(`Created ${created.length} task(s) in Donezy:\n${created.map((t) => `• ${t}`).join('\n')}`);
    if (failed.length > 0) lines.push(`Could not create ${failed.length} task(s):\n${failed.map((t) => `• ${t}`).join('\n')}`);
    return lines.join('\n\n');
  }
}
