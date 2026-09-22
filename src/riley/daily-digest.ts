import * as cron from 'node-cron';
import axios from 'axios';
import { DonezyIntegration } from '../integrations/donezy';
import { getJWTAuth } from '../utils/jwt-auth';
import { DonezyTask } from '../utils/types';

export class DailyDigest {
  private donezy: DonezyIntegration;
  private jwtAuth = getJWTAuth();

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

  private async runDigest(): Promise<void> {
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

      // Send direct message to assignee
      await this.sendDirectMessageToUser(assignee, message);
    } catch (error) {
      console.error(`[DailyDigest] Error sending digest to ${assignee}:`, error);
    }
  }

  private async sendDirectMessageToUser(displayName: string, message: string): Promise<void> {
    try {
      // Search for user by display name
      const token = await this.jwtAuth.getAccessToken();
      const searchUrl = 'https://chat.googleapis.com/v1/users:search';

      console.log(`[DailyDigest] Searching for user: ${displayName}`);

      const { data: searchResult } = await axios.post(
        searchUrl,
        {
          query: displayName,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const foundUser = searchResult.results?.[0];
      if (!foundUser) {
        console.warn(`[DailyDigest] Could not find user with name: ${displayName}`);
        return;
      }

      // Create a direct message space with the user
      const spaceUrl = 'https://chat.googleapis.com/v1/spaces';
      const { data: space } = await axios.post(
        spaceUrl,
        {
          displayName: `Task Digest - ${displayName}`,
          spaceType: 'DIRECT_MESSAGE',
          memberIds: [foundUser.name], // Google Chat user ID
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // Send message to the DM space
      const messageUrl = `https://chat.googleapis.com/v1/${space.name}/messages`;
      await axios.post(
        messageUrl,
        {
          text: message,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log(`[DailyDigest] Successfully sent digest to ${displayName}`);
    } catch (error) {
      console.error(`[DailyDigest] Error sending direct message to ${displayName}:`, error);
    }
  }
}

export const createDailyDigest = (donezy: DonezyIntegration): DailyDigest => {
  return new DailyDigest(donezy);
};
