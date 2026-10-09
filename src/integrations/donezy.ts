import { createClient } from '@supabase/supabase-js';
import { DonezyTask } from '../utils/types';
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
        .neq('status', 'completed')
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
        .neq('status', 'completed')
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
        .neq('status', 'completed')
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
        .in('status', ['awaiting_feedback_internal', 'awaiting_feedback_external'])
        .order('updated_at', { ascending: true });

      if (error) throw error;

      const now = new Date();
      const tasks = (data || []).map((row: any) => this.mapRowToTask(row));

      return tasks.filter((task) => {
        const hoursSinceUpdate = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60));

        if (task.status === 'awaiting_feedback_internal' && hoursSinceUpdate >= 24) return true;
        if (task.status === 'awaiting_feedback_external' && hoursSinceUpdate >= 24) return true;

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
        .neq('status', 'completed')
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
    if (!dueDate || status === 'completed') {
      return undefined;
    }

    const due = new Date(dueDate);
    const now = new Date();
    const daysDiff = differenceInDays(now, due);

    return daysDiff > 0 ? daysDiff : undefined;
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
        .neq('status', 'completed')
        .neq('status', 'done')
        .neq('status', 'backlog')
        .order('assignee_name', { ascending: true });

      if (error) throw error;

      const now = new Date();
      const tasks = (data || []).map((row: any) => this.mapRowToTask(row));

      const activeStatuses = ['todo', 'in_progress', 'awaiting_feedback_internal', 'awaiting_feedback_external', 'blocked'];
      const riskTasks = tasks.filter((task) => {
        if (!activeStatuses.includes(task.status as string)) {
          return false;
        }

        if (task.days_overdue && task.days_overdue > 0) return true;

        const daysSinceUpdate = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceUpdate >= 7) return true;

        const hoursSinceUpdate = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60));
        if ((task.status === 'awaiting_feedback_internal' || task.status === 'awaiting_feedback_external') && hoursSinceUpdate >= 24) return true;

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
