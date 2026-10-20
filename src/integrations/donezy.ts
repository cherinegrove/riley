import { createClient } from '@supabase/supabase-js';
import { DonezyTask, DONEZY_AWAITING_EXTERNAL, DONEZY_AWAITING_INTERNAL, DONEZY_CLOSED_STATUSES } from '../utils/types';

const MATCH_THRESHOLD = 0.75;

const compact = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const editSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
};

const similarity = (query: string, candidate: string): number => {
  const q = compact(query);
  const c = compact(candidate);
  if (!q || !c) return 0;
  const whole = editSimilarity(q, c);
  const prefix = c.length > q.length ? editSimilarity(q, c.slice(0, q.length)) : 0;
  return Math.max(whole, prefix);
};

export const bestMatch = <T>(
  query: string,
  candidates: Array<{ item: T; name: string }>
): { item: T; score: number; ties: string[] } | null => {
  const scored = candidates
    .map((candidate) => ({ ...candidate, score: similarity(query, candidate.name) }))
    .filter((c) => c.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const top = scored[0];
  const ties = scored.filter((c) => c.score === top.score).map((c) => c.name);
  return { item: top.item, score: top.score, ties };
};
import { differenceInDays } from 'date-fns';

export class DonezyIntegration {
  private supabase: ReturnType<typeof createClient>;
  private projectNames = new Map<string, string>();

  constructor(url: string, key: string) {
    this.supabase = createClient(url, key);
  }

  private async loadProjectNames(): Promise<void> {
    const { data, error } = await this.supabase.from('projects').select('id, name');
    if (error) {
      console.error('[Donezy] Failed to load project names:', error.message);
      return;
    }
    this.projectNames = new Map((data || []).map((p: any) => [p.id, p.name]));
  }

  async getTasksByProjectName(projectName: string): Promise<DonezyTask[]> {
    try {
      await this.loadProjectNames();
      const { data, error } = await this.supabase
        .from('tasks_with_assignees')
        .select('*')
        .order('due_date', { ascending: true });

      if (error) throw error;

      return (data || [])
        .map((row: any) => this.mapRowToTask(row))
        .filter((task) => (task.project_name || "").toLowerCase().includes(projectName.toLowerCase()));
    } catch (error) {
      console.error('Error fetching Donezy tasks:', error);
      return [];
    }
  }

  async getOverdueTasks(): Promise<DonezyTask[]> {
    try {
      await this.loadProjectNames();
      const { data, error } = await this.supabase
        .from('tasks_with_assignees')
        .select('*')
        .not('status', 'in', `(${DONEZY_CLOSED_STATUSES.join(',')})`)
        .order('due_date', { ascending: true });

      if (error) throw error;

      const tasks = (data || []).map((row: any) => this.mapRowToTask(row));
      return tasks.filter((task) => task.days_overdue && task.days_overdue > 0);
    } catch (error) {
      console.error('Error fetching overdue tasks:', error);
      return [];
    }
  }

  async getAllTasks(): Promise<DonezyTask[]> {
    try {
      await this.loadProjectNames();
      const { data, error } = await this.supabase
        .from('tasks_with_assignees')
        .select('*')
        .not('status', 'in', `(${DONEZY_CLOSED_STATUSES.join(',')})`)
        .order('priority', { ascending: false });

      if (error) throw error;

      return (data || []).map((row: any) => this.mapRowToTask(row));
    } catch (error) {
      console.error('Error fetching all tasks:', error);
      return [];
    }
  }

  async getTasksByClientName(clientName: string): Promise<DonezyTask[]> {
    try {
      await this.loadProjectNames();
      const normalized = clientName.toLowerCase().trim();
      const { data, error } = await this.supabase
        .from('tasks_with_assignees')
        .select('*')
        .not('status', 'in', `(${DONEZY_CLOSED_STATUSES.join(',')})`)
        .order('due_date', { ascending: true });

      if (error) throw error;

      return (data || [])
        .map((row: any) => this.mapRowToTask(row))
        .filter((task) => (task.project_name || "").toLowerCase().includes(normalized));
    } catch (error) {
      console.error('Error fetching tasks by client:', error);
      return [];
    }
  }

  async getStaleAwaitingFeedbackTasks(): Promise<DonezyTask[]> {
    try {
      await this.loadProjectNames();
      const { data, error } = await this.supabase
        .from('tasks_with_assignees')
        .select('*')
        .in('status', [DONEZY_AWAITING_INTERNAL, DONEZY_AWAITING_EXTERNAL])
        .order('updated_at', { ascending: true });

      if (error) throw error;

      const now = new Date();
      const tasks = (data || []).map((row: any) => this.mapRowToTask(row));

      return tasks.filter((task) => {
        const hoursSinceUpdate = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60));

        if (task.status === DONEZY_AWAITING_INTERNAL && hoursSinceUpdate >= 24) return true;
        if (task.status === DONEZY_AWAITING_EXTERNAL && hoursSinceUpdate >= 24) return true;

        return false;
      });
    } catch (error) {
      console.error('Error fetching stale awaiting feedback tasks:', error);
      return [];
    }
  }

  async getTasksNotUpdatedInDays(days: number = 7): Promise<DonezyTask[]> {
    try {
      await this.loadProjectNames();
      const { data, error } = await this.supabase
        .from('tasks_with_assignees')
        .select('*')
        .not('status', 'in', `(${DONEZY_CLOSED_STATUSES.join(',')})`)
        .order('updated_at', { ascending: true });

      if (error) throw error;

      const now = new Date();
      const tasks = (data || []).map((row: any) => this.mapRowToTask(row));

      return tasks.filter((task) => {
        const daysSinceUpdate = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60 * 24));
        return daysSinceUpdate >= days;
      });
    } catch (error) {
      console.error('Error fetching stale tasks:', error);
      return [];
    }
  }

  private mapRowToTask(row: any): DonezyTask {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      project_name: row.project_name || this.projectNames.get(row.project_id) || `Project ${row.project_id}`,
      status: row.status,
      priority: row.priority,
      assigned_to: row.assignee_name || row.assigned_to || 'Unassigned',
      due_date: row.due_date,
      created_at: row.created_at,
      updated_at: row.updated_at,
      days_overdue: this.calculateDaysOverdue(row.due_date, row.status),
    };
  }

  private calculateDaysOverdue(dueDate: string | null | undefined, status: string): number | undefined {
    if (!dueDate || DONEZY_CLOSED_STATUSES.includes(status)) {
      return undefined;
    }

    const due = new Date(dueDate);
    const now = new Date();
    const daysDiff = differenceInDays(now, due);

    return daysDiff > 0 ? daysDiff : undefined;
  }

  async findOpenProjectForClient(clientName: string): Promise<{ id: string; name: string } | { error: string }> {
    const { data: clients, error: clientError } = await this.supabase.from('clients').select('id, name');
    if (clientError) return { error: clientError.message };
    const { data: named, error: namedError } = await this.supabase
      .from('projects')
      .select('id, name')
      .eq('status', 'in-progress');
    if (namedError) return { error: namedError.message };

    const wanted = clientName.trim().replace(/\bclient\b/i, '').trim() || clientName.trim();
    const clientMatch = bestMatch(wanted, ((clients || []) as any[]).map((c) => ({ item: c, name: c.name })));
    const projectMatch = bestMatch(wanted, ((named || []) as any[]).map((p) => ({ item: p, name: p.name })));

    if (projectMatch && (!clientMatch || projectMatch.score > clientMatch.score)) {
      if (projectMatch.ties.length > 1) {
        return { error: `"${clientName}" could match ${projectMatch.ties.join(' or ')}. Please use the exact name` };
      }
      return { id: projectMatch.item.id, name: projectMatch.item.name };
    }
    if (!clientMatch) {
      return { error: `there is no Donezy client or open project called "${clientName}"` };
    }
    const client = clientMatch.item;

    const { data: projects, error: projectError } = await this.supabase
      .from('projects')
      .select('id, name')
      .eq('client_id', client.id)
      .eq('status', 'in-progress');
    if (projectError) return { error: projectError.message };

    const open = (projects || []) as any[];
    if (open.length === 0) return { error: `${client.name} has no open project in Donezy` };
    if (open.length > 1) {
      return { error: `${client.name} has ${open.length} open projects (${open.map((p) => p.name).join(', ')}), so I can't tell which one to use` };
    }
    return { id: open[0].id, name: open[0].name };
  }

  async getOpenProjects(): Promise<Array<{ id: string; name: string; client_name: string | null }>> {
    const { data: projects, error } = await this.supabase
      .from('projects')
      .select('id, name, client_id')
      .eq('status', 'in-progress');
    if (error) {
      console.error('[Donezy] Failed to load open projects:', error.message);
      return [];
    }

    const { data: clients } = await this.supabase.from('clients').select('id, name');
    const clientNames = new Map(((clients || []) as any[]).map((c) => [c.id, c.name as string]));

    return ((projects || []) as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      client_name: clientNames.get(p.client_id) ?? null,
    }));
  }

  async getTasksNotDoneForProject(projectId: string): Promise<DonezyTask[]> {
    await this.loadProjectNames();
    const { data, error } = await this.supabase
      .from('tasks_with_assignees')
      .select('*')
      .eq('project_id', projectId)
      .neq('status', 'done');
    if (error) {
      console.error('[Donezy] Failed to load project tasks:', error.message);
      return [];
    }
    return ((data || []) as any[]).map((row) => this.mapRowToTask(row));
  }

  async getLastCommentDates(taskIds: string[]): Promise<Map<string, string>> {
    const latest = new Map<string, string>();
    if (taskIds.length === 0) return latest;
    const { data, error } = await this.supabase
      .from('comments')
      .select('task_id, created_at')
      .in('task_id', taskIds)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[Donezy] Failed to load comment dates:', error.message);
      return latest;
    }
    for (const row of (data || []) as any[]) {
      if (!latest.has(row.task_id)) latest.set(row.task_id, row.created_at);
    }
    return latest;
  }

  async getTasksByStatus(status: string, projectName?: string): Promise<DonezyTask[]> {
    await this.loadProjectNames();
    const { data, error } = await this.supabase
      .from('tasks_with_assignees')
      .select('*')
      .eq('status', status)
      .order('updated_at', { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    const tasks = ((data || []) as any[]).map((row) => this.mapRowToTask(row));
    return projectName
      ? tasks.filter((t) => (t.project_name ?? '').toLowerCase().includes(projectName.toLowerCase()))
      : tasks;
  }

  async findOpenTasksByTitle(text: string): Promise<Array<{ id: string; title: string; project_name: string; assigned_to: string }>> {
    await this.loadProjectNames();
    const { data, error } = await this.supabase
      .from('tasks_with_assignees')
      .select('*')
      .ilike('title', `%${text.trim()}%`)
      .neq('status', 'done')
      .limit(10);
    if (error) throw new Error(error.message);
    return ((data || []) as any[]).map((row) => {
      const task = this.mapRowToTask(row);
      return { id: row.id, title: task.title, project_name: task.project_name ?? '', assigned_to: task.assigned_to };
    });
  }

  async findOpenTaskByIdPrefix(prefix: string): Promise<{ id: string; title: string; project_name: string } | null> {
    await this.loadProjectNames();
    const { data, error } = await this.supabase
      .from('tasks_with_assignees')
      .select('*')
      .neq('status', 'done');
    if (error) throw new Error(error.message);
    const wanted = prefix.toLowerCase();
    const rows = ((data || []) as any[]).filter((row) => String(row.id).toLowerCase().startsWith(wanted));
    if (rows.length !== 1) return null;
    const task = this.mapRowToTask(rows[0]);
    return { id: rows[0].id, title: task.title, project_name: task.project_name ?? '' };
  }

  async markTaskDone(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('tasks')
      .update({ status: 'done', updated_at: new Date().toISOString() } as never)
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async getAssigneeIdByName(name: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('tasks_with_assignees')
      .select('assignee_id, assignee_name')
      .not('assignee_name', 'is', null);

    if (error) {
      console.error('[Donezy] Failed to look up assignee:', error.message);
      return null;
    }

    const wanted = name.trim().toLowerCase();
    const people = ((data || []) as any[])
      .filter((row) => row.assignee_name)
      .map((row) => ({ id: row.assignee_id as string, name: (row.assignee_name as string).trim() }));

    const exact = people.find((p) => p.name.toLowerCase() === wanted);
    if (exact) return exact.id;

    const byFirstName = [...new Map(people.map((p) => [p.name, p])).values()].filter(
      (p) => p.name.toLowerCase().split(' ')[0] === wanted
    );
    return byFirstName.length === 1 ? byFirstName[0].id : null;
  }

  async createTask(input: {
    title: string;
    description: string;
    project_id: string;
    creator_id: string;
    assignee_id: string | null;
    status?: string;
    due_date?: string | null;
  }): Promise<{ id: string } | null> {
    const { data, error } = await this.supabase
      .from('tasks')
      .insert({
        title: input.title,
        description: input.description,
        project_id: input.project_id,
        auth_user_id: input.creator_id,
        assignee_id: input.assignee_id,
        status: input.status ?? 'todo',
        priority: 'medium',
        due_date: input.due_date ?? null,
      } as any)
      .select('id')
      .single();

    if (error) {
      console.error('[Donezy] Failed to create task:', error.message);
      throw new Error(error.message);
    }
    return data;
  }

  async getAtRiskTasksForAssignee(assigneeName: string): Promise<DonezyTask[]> {
    try {
      const allRiskTasks = await this.getAllRiskTasksGroupedByAssignee();
      return allRiskTasks[assigneeName] || [];
    } catch (error) {
      console.error(`Error fetching at-risk tasks for ${assigneeName}:`, error);
      return [];
    }
  }

  async getAllRiskTasksGroupedByAssignee(): Promise<{ [assignee: string]: DonezyTask[] }> {
    try {
      await this.loadProjectNames();
      const { data, error } = await this.supabase
        .from('tasks_with_assignees')
        .select('*')
        .not('status', 'in', `(${DONEZY_CLOSED_STATUSES.join(',')})`)
        .order('assignee_name', { ascending: true });

      if (error) throw error;

      const now = new Date();
      const tasks = (data || []).map((row: any) => this.mapRowToTask(row));

      const riskTasks = tasks.filter((task) => {
        if (task.days_overdue && task.days_overdue > 0) return true;

        const daysSinceUpdate = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceUpdate >= 7) return true;

        const hoursSinceUpdate = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60));
        if ((task.status === DONEZY_AWAITING_INTERNAL || task.status === DONEZY_AWAITING_EXTERNAL) && hoursSinceUpdate >= 24) return true;

        return false;
      });

      const grouped: { [assignee: string]: DonezyTask[] } = {};
      riskTasks.forEach((task) => {
        if (!grouped[task.assigned_to]) {
          grouped[task.assigned_to] = [];
        }
        grouped[task.assigned_to].push(task);
      });

      return grouped;
    } catch (error) {
      console.error('Error fetching risk tasks grouped by assignee:', error);
      return {};
    }
  }
}

export const createDonezyIntegration = (url: string, key: string): DonezyIntegration => {
  return new DonezyIntegration(url, key);
};
