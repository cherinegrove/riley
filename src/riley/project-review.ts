import * as cron from 'node-cron';
import { DonezyIntegration } from '../integrations/donezy';
import { GoogleChatIntegration } from '../integrations/google-chat';
import { RileyStore } from '../integrations/riley-store';
import { DonezyTask, DONEZY_AWAITING_EXTERNAL, DONEZY_AWAITING_INTERNAL } from '../utils/types';

const TZ = 'Africa/Johannesburg';
const DAY_MS = 24 * 60 * 60 * 1000;

const sastDate = (value: string | null | undefined): string | null => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(value).toLocaleDateString('en-CA', { timeZone: TZ });
};

const formatDate = (ymd: string): string =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });

const daysSince = (iso: string, now: Date): number => Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);

const taskLine = (task: DonezyTask, detail: string): string => `• ${task.title} – ${detail} – ${task.assigned_to}`;

export const buildReviewMessages = (projectName: string, tasks: DonezyTask[], now: Date): string[] => {
  const today = sastDate(now.toISOString()) as string;
  const weekEnd = sastDate(new Date(now.getTime() + 6 * DAY_MS).toISOString()) as string;

  const dueThisWeek = tasks.filter((t) => {
    const due = sastDate(t.due_date);
    return due !== null && due >= today && due <= weekEnd;
  });
  const noAssignee = tasks.filter((t) => t.assigned_to === 'Unassigned');
  const awaitingInternal = tasks.filter((t) => t.status === DONEZY_AWAITING_INTERNAL);
  const staleExternal = tasks.filter((t) => t.status === DONEZY_AWAITING_EXTERNAL && daysSince(t.updated_at, now) >= 7);
  const urgentOverdue = tasks.filter((t) => t.priority === 'urgent' && (sastDate(t.due_date) ?? '9999') < today);

  const sections: string[] = [];

  if (dueThisWeek.length > 0) {
    sections.push(
      [`*${projectName}* – 📅 Due this week (${dueThisWeek.length})`, ...dueThisWeek.map((t) =>
        taskLine(t, `due ${formatDate(sastDate(t.due_date) as string)} – ${t.status}`))].join('\n')
    );
  }

  if (noAssignee.length > 0) {
    sections.push(
      [`*${projectName}* – 👤 No assignee (${noAssignee.length})`, ...noAssignee.map((t) =>
        `• ${t.title} – ${t.due_date ? `due ${formatDate(sastDate(t.due_date) as string)}` : 'no due date'}`)].join('\n')
    );
  }

  if (awaitingInternal.length > 0) {
    sections.push(
      [`*${projectName}* – 🔎 Awaiting internal feedback (${awaitingInternal.length})`, ...awaitingInternal.map((t) =>
        taskLine(t, `last updated ${daysSince(t.updated_at, now)} days ago`))].join('\n')
    );
  }

  if (staleExternal.length > 0) {
    sections.push(
      [
        `*${projectName}* – ⏰ Awaiting external feedback, not updated in 7+ days (${staleExternal.length})`,
        'Owners: please send the client a follow-up and update the task in Donezy.',
        ...staleExternal.map((t) => taskLine(t, `last updated ${daysSince(t.updated_at, now)} days ago`)),
      ].join('\n')
    );
  }

  if (urgentOverdue.length > 0) {
    sections.push(
      [`*${projectName}* – 🚨 Urgent and overdue (${urgentOverdue.length})`, ...urgentOverdue.map((t) =>
        taskLine(t, `${t.days_overdue ?? 0} days overdue`))].join('\n')
    );
  }

  return sections.length > 0 ? sections : [`✅ *${projectName}*: nothing to review this week.`];
};

export class ProjectReview {
  constructor(
    private store: RileyStore,
    private chat: GoogleChatIntegration,
    private donezy: DonezyIntegration
  ) {}

  async messagesFor(projectId: string, projectName: string): Promise<string[]> {
    const tasks = await this.donezy.getOpenTasksForProject(projectId);
    return buildReviewMessages(projectName, tasks, new Date());
  }

  async runAll(): Promise<void> {
    const projects = await this.donezy.getOpenProjects();
    const spaces = await this.store.listSpaces();
    const fallback = process.env.PROPOSAL_FALLBACK_SPACE || process.env.GOOGLE_CHAT_SPACE_ID;

    for (const project of projects) {
      const clientSpace = project.client_name
        ? spaces.find((s) => s.client_key === project.client_name?.trim().toLowerCase())
        : undefined;
      const target = process.env.REVIEW_TARGET === 'client' && clientSpace ? clientSpace.space_name : fallback;
      if (!target) {
        console.error('[ProjectReview] No target space configured');
        continue;
      }

      for (const text of await this.messagesFor(project.id, project.name)) {
        await this.chat.postMessage(target, text);
      }
    }
  }

  start(): void {
    cron.schedule('0 7 * * 1', () => {
      this.runAll().catch((error) => console.error('[ProjectReview] Weekly review failed:', error));
    }, { timezone: TZ });
    console.log('[ProjectReview] Weekly project review scheduled for Mondays 7am SAST');
  }
}
