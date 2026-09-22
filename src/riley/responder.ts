import { RileyQuery, DonezyTask, HubSpotDeal, HubSpotContact } from '../utils/types';

export interface ResponseData {
  meetings?: Array<{ id: string; title: string; date: string; summary: string; actionItems: string[] }>;
  tasks?: DonezyTask[];
  deals?: HubSpotDeal[];
  contacts?: HubSpotContact[];
  lastContacted?: string;
  meetingSummary?: string;
  emailNotReplied?: boolean;
  unrepliedEmails?: Array<{ subject: string; date: string; from: string }>;
  overdueTasks?: DonezyTask[];
  staleTasks?: DonezyTask[];
  awaitingFeedbackTasks?: DonezyTask[];
}

export class RileyResponder {
  generateResponse(query: RileyQuery, data: ResponseData): string {
    switch (query.type) {
      case 'client_status':
        return this.generateClientStatusResponse(query.clientName, data);
      case 'project_status':
        return this.generateProjectStatusResponse(query.projectName, data);
      case 'overdue_tasks':
        return this.generateOverdueTasksResponse(data);
      case 'follow_ups':
        return this.generateFollowUpResponse(data);
      case 'client_tasks':
        return this.generateClientTasksResponse(query.clientName, data);
      case 'client_emails':
        return this.generateClientEmailsResponse(query.clientName, data);
      case 'client_meetings':
        return this.generateClientMeetingsResponse(query.clientName, data);
      case 'risk_review':
        return this.generateClientStatusResponse(query.clientName, data); // Reuse risk review logic
      default:
        return this.generateUnknownQueryResponse();
    }
  }

  private generateClientTasksResponse(clientName: string | undefined, data: ResponseData): string {
    if (!clientName) {
      return `I need a client name. Try: "@Riley tasks for [Client Name]"`;
    }

    let response = `*Open Tasks for ${clientName}:*\n\n`;

    if (!data.tasks || data.tasks.length === 0) {
      response += `✅ No open tasks found\n`;
      return response;
    }

    // Group by status
    const byStatus: { [key: string]: DonezyTask[] } = {};
    data.tasks.forEach((task) => {
      if (!byStatus[task.status]) {
        byStatus[task.status] = [];
      }
      byStatus[task.status].push(task);
    });

    Object.entries(byStatus).forEach(([status, tasks]) => {
      response += `*${status.toUpperCase()}* (${tasks.length}):\n`;
      tasks.forEach((task) => {
        const priority = this.getPriorityEmoji(task.priority);
        const daysOverdue = task.days_overdue ? ` - ${task.days_overdue}d overdue` : '';
        response += `  ${priority} ${task.title}${daysOverdue} [${task.assigned_to}]\n`;
      });
      response += `\n`;
    });

    return response.trim();
  }

  private generateClientEmailsResponse(clientName: string | undefined, data: ResponseData): string {
    if (!clientName) {
      return `I need a client name. Try: "@Riley emails for [Client Name]"`;
    }

    let response = `*Emails (Last 7 Days) for ${clientName}:*\n\n`;

    if (!data.unrepliedEmails || data.unrepliedEmails.length === 0) {
      response += `✅ All emails have been replied to\n`;
      return response;
    }

    response += `*Awaiting Reply:*\n`;
    const now = new Date();
    data.unrepliedEmails.forEach((email) => {
      const hoursSince = Math.floor((now.getTime() - new Date(email.date).getTime()) / (1000 * 60 * 60));
      const daysSince = Math.floor(hoursSince / 24);
      const timeStr = daysSince > 0 ? `${daysSince}d ${hoursSince % 24}h` : `${hoursSince}h`;
      response += `  📧 "${email.subject}"\n      From: ${email.from}\n      Awaiting: ${timeStr}\n\n`;
    });

    return response.trim();
  }

  private generateClientMeetingsResponse(clientName: string | undefined, data: ResponseData): string {
    if (!clientName) {
      return `I need a client name. Try: "@Riley meetings for [Client Name]"`;
    }

    let response = `*Meetings (Last 7 Days) for ${clientName}:*\n\n`;

    if (!data.meetings || data.meetings.length === 0) {
      response += `ℹ️ No meetings found\n`;
      return response;
    }

    data.meetings.forEach((meeting) => {
      response += `📞 *${meeting.title}*\n`;
      response += `   Date: ${new Date(meeting.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}\n`;

      if (meeting.actionItems && meeting.actionItems.length > 0) {
        response += `   Action Items:\n`;
        meeting.actionItems.forEach((item) => {
          response += `     • ${item}\n`;
        });
      } else {
        response += `   (No action items recorded)\n`;
      }
      response += `\n`;
    });

    return response.trim();
  }

  private generateClientStatusResponse(clientName: string | undefined, data: ResponseData): string {
    if (!clientName) {
      return `I need a client name to check their status. Try: "@Riley how are we doing on [Client Name]?"`;
    }

    let response = `*Status for ${clientName}:*\n`;
    response += `Last contacted: ${data.lastContacted || 'No record found'}\n`;

    // Risk Items Section - DETAILED
    const now = new Date();

    // 1. EMAILS AWAITING REPLY (24+ hours)
    if (data.unrepliedEmails && data.unrepliedEmails.length > 0) {
      response += `\n📧 *EMAILS AWAITING REPLY:*\n`;
      data.unrepliedEmails.forEach((email) => {
        const hoursSince = Math.floor((now.getTime() - new Date(email.date).getTime()) / (1000 * 60 * 60));
        const daysSince = Math.floor(hoursSince / 24);
        const timeStr = daysSince > 0 ? `${daysSince}d ${hoursSince % 24}h` : `${hoursSince}h`;
        response += `  • "${email.subject}" from ${email.from} - awaiting ${timeStr}\n`;
      });
    }

    // 2. ACTION ITEMS FROM MEETINGS WITHOUT TASKS
    if (data.meetings && data.meetings.length > 0) {
      const taskTitles = (data.tasks || []).map((t) => t.title.toLowerCase());
      const missingActions: Array<{ item: string; meeting: string }> = [];

      for (const meeting of data.meetings) {
        for (const actionItem of meeting.actionItems || []) {
          const actionLower = actionItem.toLowerCase();
          const hasTask = taskTitles.some((taskTitle) =>
            taskTitle.includes(actionLower.substring(0, 30)) || actionLower.includes(taskTitle.substring(0, 30))
          );

          if (!hasTask) {
            missingActions.push({ item: actionItem, meeting: meeting.title });
          }
        }
      }

      if (missingActions.length > 0) {
        response += `\n📋 *MISSING TASKS FROM MEETINGS (${missingActions.length}):*\n`;
        missingActions.forEach((action) => {
          response += `  • "${action.item}" from "${action.meeting}"\n`;
        });
      }
    }

    // 3. OVERDUE TASKS (with days overdue)
    if (data.overdueTasks && data.overdueTasks.length > 0) {
      response += `\n🚨 *OVERDUE TASKS (${data.overdueTasks.length}):*\n`;
      data.overdueTasks.slice(0, 5).forEach((task) => {
        const daysOverdue = task.days_overdue || 0;
        response += `  • ${task.title} - ${daysOverdue} days overdue [${task.assigned_to}]\n`;
      });
      if (data.overdueTasks.length > 5) {
        response += `  ...and ${data.overdueTasks.length - 5} more\n`;
      }
    }

    // 4. TASKS NOT UPDATED (with days since update)
    if (data.staleTasks && data.staleTasks.length > 0) {
      response += `\n⏳ *TASKS NOT UPDATED 7+ DAYS (${data.staleTasks.length}):*\n`;
      data.staleTasks.slice(0, 5).forEach((task) => {
        const daysSinceUpdate = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60 * 24));
        response += `  • ${task.title} - not updated ${daysSinceUpdate} days [${task.assigned_to}]\n`;
      });
      if (data.staleTasks.length > 5) {
        response += `  ...and ${data.staleTasks.length - 5} more\n`;
      }
    }

    // 5. AWAITING FEEDBACK TASKS (with time in state)
    if (data.awaitingFeedbackTasks && data.awaitingFeedbackTasks.length > 0) {
      const internal = data.awaitingFeedbackTasks.filter((t) => (t.status as string) === 'awaiting_feedback_internal');
      const external = data.awaitingFeedbackTasks.filter((t) => (t.status as string) === 'awaiting_feedback_external');

      if (internal.length > 0) {
        response += `\n⏰ *AWAITING INTERNAL FEEDBACK 48+ HOURS (${internal.length}):*\n`;
        internal.slice(0, 3).forEach((task) => {
          const hoursSince = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60));
          response += `  • ${task.title} - waiting ${hoursSince}h [${task.assigned_to}]\n`;
        });
      }

      if (external.length > 0) {
        response += `\n⏰ *AWAITING EXTERNAL FEEDBACK 7+ DAYS (${external.length}):*\n`;
        external.slice(0, 3).forEach((task) => {
          const daysSince = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60 * 24));
          response += `  • ${task.title} - waiting ${daysSince} days [${task.assigned_to}]\n`;
        });
      }
    }

    // Add summary if nothing to report
    const hasEmails = data.unrepliedEmails && data.unrepliedEmails.length > 0;
    const hasActionItems = data.meetings && data.meetings.some((m) => m.actionItems && m.actionItems.length > 0);
    const hasOverdue = data.overdueTasks && data.overdueTasks.length > 0;
    const hasStale = data.staleTasks && data.staleTasks.length > 0;
    const hasAwaitingFeedback = data.awaitingFeedbackTasks && data.awaitingFeedbackTasks.length > 0;

    if (!hasEmails && !hasActionItems && !hasOverdue && !hasStale && !hasAwaitingFeedback) {
      response += `\n✅ *All clear!*\n`;
      response += `Checked:\n`;
      response += `  • Email replies - all up to date\n`;
      response += `  • Meeting action items - all have tasks\n`;
      response += `  • Task deadlines - none overdue\n`;
      response += `  • Task updates - all current\n`;
      response += `  • Awaiting feedback - none stuck\n`;
    }

    return response.trim();
  }

  private generateProjectStatusResponse(projectName: string | undefined, data: ResponseData): string {
    if (!projectName) {
      return `I need a project name. Try: "@Riley status on [Project Name]?"`;
    }

    let response = `*Status for ${projectName}:*\n`;

    // Filter tasks for this project
    const projectTasks = data.tasks?.filter((t) => t.project_name === projectName) || [];

    if (projectTasks.length === 0) {
      response += `No tasks found for this project.`;
      return response;
    }

    const completed = projectTasks.filter((t) => t.status === 'completed').length;
    const total = projectTasks.length;
    const progress = Math.round((completed / total) * 100);

    response += `Progress: ${progress}% (${completed}/${total} tasks complete)\n\n`;

    // Group by status
    const byStatus: { [key: string]: DonezyTask[] } = {};
    projectTasks.forEach((task) => {
      if (!byStatus[task.status]) {
        byStatus[task.status] = [];
      }
      byStatus[task.status].push(task);
    });

    Object.entries(byStatus).forEach(([status, tasks]) => {
      if (tasks.length > 0) {
        response += `*${this.statusToEmoji(status)} ${status.toUpperCase()}* (${tasks.length}):\n`;
        tasks.slice(0, 2).forEach((task) => {
          const priority = this.getPriorityEmoji(task.priority);
          response += `  ${priority} ${task.title} [${task.assigned_to}]\n`;
        });
        response += '\n';
      }
    });

    return response.trim();
  }

  private generateOverdueTasksResponse(data: ResponseData): string {
    const overdueTasks = (data.tasks || []).filter((t) => t.days_overdue && t.days_overdue > 0 && t.status !== 'completed');

    if (overdueTasks.length === 0) {
      return `✅ No overdue tasks! Everything is on track.`;
    }

    // Sort by days overdue descending
    const sorted = overdueTasks.sort((a, b) => (b.days_overdue || 0) - (a.days_overdue || 0));

    let response = `⚠️ *${sorted.length} Overdue Tasks*:\n\n`;

    sorted.slice(0, 10).forEach((task, index) => {
      const priority = this.getPriorityEmoji(task.priority);
      response += `${index + 1}. ${priority} ${task.title}\n`;
      response += `   Assigned to: ${task.assigned_to}\n`;
      response += `   Overdue: ${task.days_overdue} days\n`;
      response += `   Status: ${task.status}\n\n`;
    });

    if (sorted.length > 10) {
      response += `...and ${sorted.length - 10} more overdue tasks.`;
    }

    return response.trim();
  }

  private generateFollowUpResponse(data: ResponseData): string {
    const needsFollowUp: { contact: HubSpotContact; deal: HubSpotDeal; daysSince: number }[] = [];

    if (data.deals && data.contacts) {
      data.deals.forEach((deal) => {
        const daysSince = deal.lastactivitydate ? this.daysSinceDate(deal.lastactivitydate) : 999;
        if (daysSince > 7) {
          const contact = data.contacts?.find((c) => c.id === deal.associated_company);
          if (contact) {
            needsFollowUp.push({
              contact,
              deal,
              daysSince,
            });
          }
        }
      });
    }

    if (needsFollowUp.length === 0) {
      return `✅ All contacts are up to date with recent activity!`;
    }

    // Sort by days since descending
    needsFollowUp.sort((a, b) => b.daysSince - a.daysSince);

    let response = `📞 *${needsFollowUp.length} Contacts Need Follow-up*:\n\n`;

    needsFollowUp.slice(0, 10).forEach((item, index) => {
      response += `${index + 1}. ${item.contact.firstname} ${item.contact.lastname}\n`;
      response += `   Last activity: ${item.daysSince} days ago\n`;
      response += `   Deal: ${item.deal.dealname} (${item.deal.dealstage})\n\n`;
    });

    if (needsFollowUp.length > 10) {
      response += `...and ${needsFollowUp.length - 10} more awaiting follow-up.`;
    }

    return response.trim();
  }

  private generateUnknownQueryResponse(): string {
    return `I didn't quite understand that. Here's what I can help with:\n\n` +
      `**Status Commands:**\n` +
      `• *@Riley how are we doing on [Client]*\n` +
      `• *@Riley status on [Project]*\n\n` +
      `**Slash Commands:**\n` +
      `• *@Riley /tasks [Client]* - List all open tasks\n` +
      `• *@Riley /emails [Client]* - Show emails from last 7 days\n` +
      `• *@Riley /meetings [Client]* - Show meetings from last 7 days\n` +
      `• *@Riley /risk [Client]* - Complete risk review\n\n` +
      `**Other:**\n` +
      `• *@Riley what's overdue?* - List overdue tasks\n` +
      `• *@Riley who needs a follow-up?* - Find stale contacts\n`;
  }

  private getPriorityEmoji(priority: string): string {
    const emojis: { [key: string]: string } = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢',
    };
    return emojis[priority] || '⚪';
  }

  private statusToEmoji(status: string): string {
    const emojis: { [key: string]: string } = {
      completed: '✅',
      in_progress: '🔄',
      todo: '📝',
      blocked: '🚫',
    };
    return emojis[status] || '◻️';
  }

  private daysSinceDate(dateString: string): number {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

}

export const createResponder = (): RileyResponder => {
  return new RileyResponder();
};
