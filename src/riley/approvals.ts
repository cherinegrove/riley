import { DonezyIntegration } from '../integrations/donezy';
import { PendingProposal, RileyStore } from '../integrations/riley-store';
import { donezyTaskUrl } from '../utils/types';

export const APPROVER_EMAIL = 'cherine@cybersolve.net';
export const CREATOR_DONEZY_USER_ID = 'c5186049-990e-43c5-847a-c5bf0bc46220';

export type ApproveCommand = { kind: 'decline' } | { kind: 'approve'; numbers: number[] | 'all' };

export const parseApproval = (text: string): ApproveCommand | null => {
  const cleaned = text.replace(/@riley\b/i, '').trim();

  if (/^no$/i.test(cleaned)) return { kind: 'decline' };

  const match = cleaned.match(/^yes\b\s*(.*)$/i);
  if (!match) return null;

  const rest = match[1].trim().toLowerCase();
  if (rest === 'all') return { kind: 'approve', numbers: 'all' };
  if (rest === '') return { kind: 'approve', numbers: [] };

  const numbers = rest.split(/[\s,]+/).filter((part) => part !== '').map(Number);
  if (numbers.length === 0) return { kind: 'approve', numbers: [] };
  if (numbers.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  return { kind: 'approve', numbers };
};

const CLIENT_LINE = /^\s*client\s+(.+)$/im;

export class ApprovalService {
  constructor(private store: RileyStore, private donezy: DonezyIntegration) {}

  async handle(text: string, spaceName: string, threadName: string | undefined, senderEmail: string | undefined): Promise<string | null> {
    const cleaned = text.replace(/@riley\b/i, '').trim();
    const clientLine = cleaned.match(CLIENT_LINE);
    const remainder = clientLine ? cleaned.replace(clientLine[0], '').trim() : cleaned;
    const command = parseApproval(remainder);

    if (!clientLine && !command) return null;

    const proposal = await this.store.findPendingProposal(spaceName, threadName);
    if (!proposal) return null;

    if (senderEmail?.toLowerCase() !== APPROVER_EMAIL) {
      return 'Only Cherine can approve tasks for this proposal.';
    }

    if (new Date(proposal.expires_at) < new Date()) {
      await this.store.updateProposalStatus(proposal.id, 'expired');
      return `This proposal for "${proposal.title}" has expired. Ask me to re-run the meeting check to get a new one.`;
    }

    let clientKey = proposal.client_key;
    let filedMessage: string | null = null;

    if (clientLine) {
      const name = clientLine[1].trim();
      const project = await this.donezy.findOpenProjectForClient(name);
      if ('error' in project) {
        return `I can't file this under "${name}": ${project.error}.`;
      }
      await this.store.setProposalClient(proposal.id, name);
      clientKey = name;
      filedMessage = `Filed under ${name} (open project: ${project.name}).`;
    }

    if (!command) {
      return `${filedMessage} Now reply with the numbers to create, e.g. \`yes 1,3\`.`;
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

    const resolvedClient = clientKey ?? (await this.store.clientKeyForSpace(spaceName));
    if (!resolvedClient) {
      return "I can't create these tasks yet: reply `client <name>` in this thread first.";
    }

    const project = await this.donezy.findOpenProjectForClient(resolvedClient);
    if ('error' in project) {
      return `I can't create these tasks yet: ${project.error}.`;
    }

    const result = await this.createTasks(proposal, chosen, project.id);
    return filedMessage ? `${filedMessage}\n\n${result}` : result;
  }

  async handleTaskUpdate(text: string, senderEmail: string | undefined): Promise<string | null> {
    const cleaned = text.replace(/@riley\b/i, '').trim();
    const confirm = cleaned.match(/^confirm\s+done\s+([0-9a-f]{6,})$/i);
    const mark = cleaned.match(/^(?:please\s+)?(?:mark|set)\s+["“]?(.+?)["”]?\s+as\s+done[.!]?$/i);
    if (!confirm && !mark) return null;

    if (senderEmail?.toLowerCase() !== APPROVER_EMAIL) {
      return 'Only Cherine can change tasks from chat.';
    }

    if (confirm) {
      const task = await this.donezy.findOpenTaskByIdPrefix(confirm[1]);
      if (!task) {
        return `I couldn't find one open task with the ID ${confirm[1]}. Ask me to mark it done again to get the current ID.`;
      }
      await this.donezy.markTaskDone(task.id);
      return `Marked "${task.title}" as done in ${task.project_name}.\n${donezyTaskUrl(task.id)}`;
    }

    const matches = await this.donezy.findOpenTasksByTitle(mark![1]);
    if (matches.length === 0) {
      return `I couldn't find an open task matching "${mark![1]}".`;
    }
    const lines = matches.map((t) => `• ${t.title} – ${t.project_name} – ${t.assigned_to} (ID ${t.id.slice(0, 8)})\n  ${donezyTaskUrl(t.id)}`);
    if (matches.length === 1) {
      return `Found one open task:\n${lines[0]}\nReply \`confirm done ${matches[0].id.slice(0, 8)}\` to mark it done.`;
    }
    return `Found ${matches.length} open tasks matching "${mark![1]}". Pick one and reply \`confirm done <ID>\`:\n${lines.join('\n')}`;
  }

  async handleCreateRequest(text: string, senderEmail: string | undefined): Promise<string | null> {
    const cleaned = text.replace(/@riley\b/i, '').trim();
    const header = cleaned.match(/\bcreate\b[^\n]*?\bunder\s+([^\n]+)/i);
    if (!header) return null;

    if (senderEmail?.toLowerCase() !== APPROVER_EMAIL) {
      return 'Only Cherine can create tasks from chat.';
    }

    const target = header[1].trim().replace(/\s+client$/i, '');
    const titles = cleaned
      .split('\n')
      .map((line) => line.match(/^\s*\d+[.)]\s+(.+)$/)?.[1].trim())
      .filter((title): title is string => !!title);
    if (titles.length === 0) return null;

    const project = await this.donezy.findOpenProjectForClient(target);
    if ('error' in project) {
      return `I can't create these tasks: ${project.error}. Name the client or project exactly, e.g. "under Stratasys Direct".`;
    }

    const created: string[] = [];
    const failed: string[] = [];
    for (const title of titles) {
      try {
        await this.donezy.createTask({
          title,
          description: 'Created from Riley chat',
          project_id: project.id,
          creator_id: CREATOR_DONEZY_USER_ID,
          assignee_id: null,
        });
        created.push(title);
      } catch (error) {
        failed.push(`${title} (${error instanceof Error ? error.message : String(error)})`);
      }
    }

    const lines: string[] = [];
    if (created.length > 0) lines.push(`Created ${created.length} task(s) in ${project.name}:\n${created.map((t) => `• ${t}`).join('\n')}`);
    if (failed.length > 0) lines.push(`Could not create ${failed.length} task(s):\n${failed.map((t) => `• ${t}`).join('\n')}`);
    return lines.join('\n\n');
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
