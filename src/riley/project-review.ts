import * as cron from 'node-cron';
import { DonezyIntegration } from '../integrations/donezy';
import { GoogleChatIntegration } from '../integrations/google-chat';
import { RileyStore } from '../integrations/riley-store';
import { DonezyTask, DONEZY_AWAITING_EXTERNAL, DONEZY_AWAITING_INTERNAL, donezyTaskUrl } from '../utils/types';

const TZ = 'Africa/Johannesburg';
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReviewCategory = 'overdue' | 'due_today' | 'unassigned' | 'no_due_date' | 'external' | 'internal' | 'backlog';

const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const sastDate = (value: string | null | undefined): string | null => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(value).toLocaleDateString('en-CA', { timeZone: TZ });
};

const formatDate = (ymd: string): string =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });

const daysSince = (iso: string, now: Date): number => Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);

const taskLine = (task: DonezyTask, detail: string): string =>
  `• ${task.title} – ${detail}\n  ${donezyTaskUrl(task.id)}`;

const byAssignee = (tasks: DonezyTask[]): Array<[string, DonezyTask[]]> => {
  const groups = new Map<string, DonezyTask[]>();
  for (const task of tasks) {
    groups.set(task.assigned_to, [...(groups.get(task.assigned_to) ?? []), task]);
  }
  return [...groups.entries()];
};

export const buildCategoryMessage = (
  category: ReviewCategory,
  projectName: string,
  tasks: DonezyTask[],
  now: Date,
  lastComments: Map<string, string> = new Map()
): string | null => {
  const today = sastDate(now.toISOString()) as string;
  const open = tasks.filter((t) => t.status !== 'backlog');

  if (category === 'overdue') {
    const list = open.filter((t) => (sastDate(t.due_date) ?? '9999') < today);
    if (list.length === 0) return null;
    return [
      `ACTION REQUIRED Overdue tasks on ${projectName}`,
      '',
      'Please update these tasks by completing them, or leaving a comment and changing the due date.',
      '',
      ...list.map((t) => taskLine(t, `${t.days_overdue ?? 0} days overdue – ${t.assigned_to}`)),
    ].join('\n');
  }

  if (category === 'due_today') {
    const list = open.filter((t) => sastDate(t.due_date) === today);
    if (list.length === 0) return null;
    return [
      `ACTION REQUIRED Due today – ${projectName}`,
      '',
      'These tasks are due today!',
      '',
      ...list.map((t) => taskLine(t, `${t.assigned_to} – ${t.status}`)),
    ].join('\n');
  }

  if (category === 'unassigned') {
    const list = open.filter((t) => t.assigned_to === 'Unassigned');
    if (list.length === 0) return null;
    return [
      `ACTION REQUIRED Unassigned tasks – ${projectName}`,
      '',
      'Please assign these tasks to the correct Consultant',
      '',
      ...list.map((t) => taskLine(t, t.due_date ? formatDate(sastDate(t.due_date) as string) : 'no due date')),
    ].join('\n');
  }

  if (category === 'no_due_date') {
    const list = open.filter((t) => !t.due_date);
    if (list.length === 0) return null;
    return [
      `ACTION REQUIRED No due date – ${projectName}`,
      '',
      'Please add a due date to these tasks.',
      '',
      ...list.map((t) => taskLine(t, t.assigned_to)),
    ].join('\n');
  }

  if (category === 'external' || category === 'internal') {
    const status = category === 'external' ? DONEZY_AWAITING_EXTERNAL : DONEZY_AWAITING_INTERNAL;
    const list = open.filter((t) => t.status === status);
    if (list.length === 0) return null;
    const heading = category === 'external' ? 'Awaiting external feedback' : 'Awaiting internal feedback';
    const ask = category === 'external'
      ? 'please follow up with the client and update the task in Donezy.'
      : 'please follow up on these and update the task in Donezy.';
    const groups = byAssignee(list).map(([name, group]) =>
      [
        `${name}: ${ask}`,
        ...group.map((t) => {
          const last = lastComments.get(t.id);
          const commentText = last
            ? `last comment ${formatDate(sastDate(last) as string)} (${daysSince(last, now)} days ago)`
            : 'no comments yet';
          return taskLine(t, `${commentText}, last updated ${daysSince(t.updated_at, now)} days ago`);
        }),
      ].join('\n')
    );
    return [`ACTION REQUIRED ${heading} – ${projectName}`, '', groups.join('\n\n')].join('\n');
  }

  const backlog = tasks.filter((t) => t.status === 'backlog');
  if (backlog.length === 0) return null;
  return [
    `ACTION REQUIRED Backlog – ${projectName}`,
    '',
    'Please review these backlog tasks and move them forward or close them.',
    '',
    ...backlog.map((t) => taskLine(t, t.assigned_to)),
  ].join('\n');
};

export class ProjectReview {
  constructor(
    private store: RileyStore,
    private chat: GoogleChatIntegration,
    private donezy: DonezyIntegration
  ) {}

  async messagesFor(projectId: string, projectName: string, category: ReviewCategory): Promise<string[]> {
    const tasks = await this.donezy.getTasksNotDoneForProject(projectId);
    const lastComments = category === 'external' || category === 'internal'
      ? await this.donezy.getLastCommentDates(tasks.map((t) => t.id))
      : new Map<string, string>();
    const message = buildCategoryMessage(category, projectName, tasks, new Date(), lastComments);
    return message ? [message] : [];
  }

  async runCategory(category: ReviewCategory, onlyWithSpace = false): Promise<void> {
    const projects = await this.donezy.getOpenProjects();
    const spaces = await this.store.listSpaces();
    const fallback = process.env.PROPOSAL_FALLBACK_SPACE || process.env.GOOGLE_CHAT_SPACE_ID;
    const spaceFor = (name: string | null) =>
      name ? spaces.find((s) => s.client_key && normalise(s.client_key) === normalise(name)) : undefined;

    for (const project of projects) {
      const projectSpace = spaceFor(project.name) ?? spaceFor(project.client_name);
      if (onlyWithSpace && !projectSpace) continue;
      const target = process.env.REVIEW_TARGET === 'client' && projectSpace ? projectSpace.space_name : fallback;
      if (!target) {
        console.error('[ProjectReview] No target space configured');
        continue;
      }

      for (const text of await this.messagesFor(project.id, project.name, category)) {
        await this.chat.postMessage(target, text);
      }
    }
  }

  start(): void {
    const schedules: Array<{ expression: string; category: ReviewCategory }> = [
      { expression: '0 7 * * *', category: 'overdue' },
      { expression: '0 10 * * *', category: 'due_today' },
      { expression: '0 12 * * *', category: 'unassigned' },
      { expression: '0 12 * * *', category: 'no_due_date' },
      { expression: '0 8 * * 1', category: 'external' },
      { expression: '0 8 * * 5', category: 'internal' },
      { expression: '0 12 * * 5', category: 'backlog' },
    ];
    for (const { expression, category } of schedules) {
      cron.schedule(expression, () => {
        this.runCategory(category).catch((error) => console.error(`[ProjectReview] ${category} failed:`, error));
      }, { timezone: TZ });
    }
    console.log('[ProjectReview] Project review schedules started (SAST)');
  }
}
