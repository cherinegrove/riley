import * as cron from 'node-cron';
import { DonezyIntegration } from '../integrations/donezy';
import { DonezyTask } from '../utils/types';

export class DailyDigest {
  private donezy: DonezyIntegration;

  constructor(donezy: DonezyIntegration) {
    this.donezy = donezy;
  }

  /**
   * Start the daily digest scheduler (7am SAST = 5am UTC)
   */
  start(): void {
    // 7am SAST = 5am UTC (SAST is UTC+2)
    const schedule = '0 5 * * *'; // 5am UTC every day

    cron.schedule(schedule, async () => {
      console.log('[DailyDigest] Starting 7am SAST digest run');
      await this.runDigest();
    });

    console.log('[DailyDigest] Scheduler started - will run daily at 7am SAST');
  }

  async runDigest(): Promise<void> {
    try {
      console.log('[DailyDigest] Fetching all at-risk tasks grouped by assignee');
      const tasksByAssignee = await this.donezy.getAllRiskTasksGroupedByAssignee();

      if (Object.keys(tasksByAssignee).length === 0) {
        console.log('[DailyDigest] No at-risk tasks found');
        return;
      }

      // Send message to each assignee
      for (const [assignee, tasks] of Object.entries(tasksByAssignee)) {
        console.log(`[DailyDigest] Sending digest to ${assignee} (${tasks.length} at-risk tasks)`);
        await this.sendDigestToAssignee(assignee, tasks);
      }

      console.log('[DailyDigest] Digest run completed');
    } catch (error) {
      console.error('[DailyDigest] Error running digest:', error);
    }
  }

  private async sendDigestToAssignee(assignee: string, tasks: DonezyTask[]): Promise<void> {
    try {
      // Group tasks by risk category
      const overdue = tasks.filter((t) => t.days_overdue && t.days_overdue > 0);
      const stale = tasks.filter((t) => {
        const daysSinceUpdate = Math.floor((new Date().getTime() - new Date(t.updated_at).getTime()) / (1000 * 60 * 60 * 24));
        return daysSinceUpdate >= 7;
      });
      const awaitingFeedback = tasks.filter((t) =>
        t.status === 'awaiting_feedback_internal' || t.status === 'awaiting_feedback_external'
      );

      // Format message
      let message = `*Daily Task Digest for ${assignee}*\n\n`;
      message += `You have *${tasks.length} at-risk tasks* that need attention:\n\n`;

      if (overdue.length > 0) {
        message += `🚨 *OVERDUE (${overdue.length}):*\n`;
        overdue.forEach((task) => {
          message += `  • ${task.title} - ${task.days_overdue} days overdue [${task.project_name}]\n`;
        });
        message += `\n`;
      }

      if (awaitingFeedback.length > 0) {
        message += `⏰ *AWAITING FEEDBACK (${awaitingFeedback.length}):*\n`;
        awaitingFeedback.forEach((task) => {
          const status = (task.status as string) === 'awaiting_feedback_internal' ? 'Internal' : 'External';
          message += `  • ${task.title} - ${status} [${task.project_name}]\n`;
        });
        message += `\n`;
      }

      if (stale.length > 0) {
        message += `⏳ *NOT UPDATED 7+ DAYS (${stale.length}):*\n`;
        stale.forEach((task) => {
          message += `  • ${task.title} [${task.project_name}]\n`;
        });
        message += `\n`;
      }

      message += `Please review and update these tasks in Donezy.`;

      // TODO: Send direct message to assignee via Google Chat
      // For now, just log the message that would be sent
      console.log(`[DailyDigest] Message for ${assignee}:\n${message}`);
    } catch (error) {
      console.error(`[DailyDigest] Error sending digest to ${assignee}:`, error);
    }
  }

  // TODO: Implement Google Chat direct messaging
  // Currently disabled due to users:search endpoint returning 404
  // Will need to integrate with HubSpot to find user emails or use a user mapping table
}

export const createDailyDigest = (donezy: DonezyIntegration): DailyDigest => {
  return new DailyDigest(donezy);
};
