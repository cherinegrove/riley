import { DonezyIntegration } from '../integrations/donezy';
import { HubSpotIntegration } from '../integrations/hubspot';
import { DonezyTask } from '../utils/types';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_ROUNDS = 4;
const MAX_ITEMS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const TOOLS = [
  {
    name: 'client_open_tasks',
    description: 'List open (not done) Donezy tasks whose project name contains the client name.',
    input_schema: {
      type: 'object',
      properties: { client_name: { type: 'string' } },
      required: ['client_name'],
    },
  },
  {
    name: 'at_risk_tasks',
    description: 'List at-risk Donezy tasks (overdue, awaiting feedback 24h+, or not updated in 7+ days) for a person (assignee name) or a client/project name.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'overdue_tasks',
    description: 'List overdue open Donezy tasks across all projects, optionally filtered to a project name.',
    input_schema: {
      type: 'object',
      properties: { project_name: { type: 'string' } },
    },
  },
  {
    name: 'tasks_by_status',
    description: 'List Donezy tasks with an exact status, optionally filtered to a project name. Valid statuses: backlog, todo, in-progress, review, awaiting-ext (awaiting external feedback), awaiting-feedback-(internal) (awaiting internal feedback), done.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        project_name: { type: 'string' },
      },
      required: ['status'],
    },
  },
  {
    name: 'find_open_tasks',
    description: 'Search open Donezy tasks by part of their title. Use this when the user wants to close or mark a task done: it returns the matches with short IDs. It never changes anything.',
    input_schema: {
      type: 'object',
      properties: { title_text: { type: 'string' } },
      required: ['title_text'],
    },
  },
  {
    name: 'hubspot_company_activity',
    description: 'Get HubSpot company activity: last contacted date, recent meetings with action items, and emails awaiting a reply.',
    input_schema: {
      type: 'object',
      properties: { company_name: { type: 'string' } },
      required: ['company_name'],
    },
  },
];

type ToolInput = Record<string, string>;

export class Assistant {
  constructor(
    private apiKey: string | undefined,
    private donezy: DonezyIntegration,
    private hubspot: HubSpotIntegration
  ) {}

  get enabled(): boolean {
    return !!this.apiKey;
  }

  async answer(question: string): Promise<string> {
    const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [{ role: 'user', content: question }];
    const system =
      'You are Riley, the project manager bot for Cybersolve. Answer the user\'s question using the tools when you need data. ' +
      'You are read-only: never claim to have changed anything. Be brief and plain, no emojis, use short bullet points. ' +
      'If the question is unclear or no tool fits, ask one short clarifying question. ' +
      'When the user asks to close or mark a task done, use find_open_tasks, list the matches with their short IDs, and tell them to reply "@Riley confirm done <short ID>" to mark it done. ' +
      'Never say a task has been marked done, because you cannot change tasks.';

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey as string,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: MODEL, max_tokens: 800, system, tools: TOOLS, messages }),
      });
      if (!response.ok) {
        console.error('[Assistant] Anthropic error:', response.status, await response.text());
        return "I couldn't work that out just now. Try one of the commands from the help menu.";
      }

      const body = (await response.json()) as {
        stop_reason: string;
        content: Array<{ type: string; text?: string; id?: string; name?: string; input?: ToolInput }>;
      };

      if (body.stop_reason !== 'tool_use') {
        const text = body.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim();
        return text || "I'm not sure what you need. Could you rephrase?";
      }

      messages.push({ role: 'assistant', content: body.content });
      const results = [];
      for (const block of body.content.filter((b) => b.type === 'tool_use')) {
        const output = await this.runTool(block.name as string, block.input ?? {});
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(output) });
      }
      messages.push({ role: 'user', content: results });
    }

    return 'That took too many steps to answer. Try asking about one client or person at a time.';
  }

  private async runTool(name: string, input: ToolInput): Promise<unknown> {
    try {
      if (name === 'client_open_tasks') {
        return summariseTasks(await this.donezy.getTasksByClientName(input.client_name));
      }
      if (name === 'at_risk_tasks') {
        const byAssignee = await this.donezy.getAllRiskTasksGroupedByAssignee();
        const wanted = input.name.trim().toLowerCase();
        const person = Object.entries(byAssignee).find(([assignee]) => assignee.toLowerCase() === wanted);
        if (person) return { person: person[0], tasks: summariseTasks(person[1]) };
        return { project_or_client: input.name, tasks: summariseTasks(await this.donezy.getTasksByClientName(input.name)).filter((t) => t.at_risk) };
      }
      if (name === 'overdue_tasks') {
        const overdue = await this.donezy.getOverdueTasks();
        const filtered = input.project_name
          ? overdue.filter((t) => t.project_name?.toLowerCase().includes(input.project_name.toLowerCase()))
          : overdue;
        return summariseTasks(filtered);
      }
      if (name === 'tasks_by_status') {
        const tasks = await this.donezy.getTasksByStatus(input.status, input.project_name);
        return summariseTasks(tasks);
      }
      if (name === 'find_open_tasks') {
        const matches = await this.donezy.findOpenTasksByTitle(input.title_text);
        return matches.map((t) => ({
          short_id: t.id.slice(0, 8),
          title: t.title,
          project: t.project_name,
          assignee: t.assigned_to,
        }));
      }
      if (name === 'hubspot_company_activity') {
        const company = await this.hubspot.getCompanyLastContacted(input.company_name);
        return {
          last_contacted: company.lastContacted,
          meetings: (company.meetings || []).slice(0, 5).map((m) => ({ title: m.title, date: m.date, action_items: m.actionItems.slice(0, 10) })),
          emails_awaiting_reply: (company.unrepliedEmails || []).slice(0, MAX_ITEMS),
        };
      }
      return { error: `unknown tool ${name}` };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}

const summariseTasks = (tasks: DonezyTask[]) => {
  const now = Date.now();
  return tasks.slice(0, MAX_ITEMS).map((t) => {
    const updatedDays = Math.floor((now - new Date(t.updated_at).getTime()) / DAY_MS);
    const overdue = (t.days_overdue ?? 0) > 0;
    return {
      title: t.title,
      project: t.project_name,
      status: t.status,
      priority: t.priority,
      assignee: t.assigned_to,
      due_date: t.due_date ?? null,
      days_overdue: t.days_overdue ?? 0,
      days_since_update: updatedDays,
      at_risk: overdue || updatedDays >= 7,
    };
  });
};
