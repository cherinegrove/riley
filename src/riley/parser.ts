import { RileyQuery } from '../utils/types';

const QUERY_PATTERNS = {
  clientStatus: /(client status|how are we doing on)\s+(.+)\??/i,
  projectStatus: /(project status|status on)\s+(.+)\??/i,
  overdueTask: /what'?s? overdue\??/i,
  followUp: /(who needs (?:a )?follow-?up|follow.?ups needed)\??/i,
  clientTasks: /\/tasks\s+(.+)\??/i,
  clientEmails: /\/emails\s+(.+)\??/i,
  clientMeetings: /\/meetings\s+(.+)\??/i,
  riskReview: /\/risk\s+(.+)\??/i,
};

export class RileyParser {
  parse(text: string): RileyQuery {
    // Clean up the text - remove @ mentions and extra whitespace
    const cleaned = text.replace(/@riley\b/i, '').trim();

    // Check for client status query
    const clientMatch = cleaned.match(QUERY_PATTERNS.clientStatus);
    if (clientMatch) {
      return {
        type: 'client_status',
        clientName: clientMatch[2].trim(),
        raw: cleaned,
      };
    }

    // Check for project status query
    const projectMatch = cleaned.match(QUERY_PATTERNS.projectStatus);
    if (projectMatch) {
      return {
        type: 'project_status',
        projectName: projectMatch[2].trim(),
        raw: cleaned,
      };
    }

    // Check for overdue tasks query
    if (QUERY_PATTERNS.overdueTask.test(cleaned)) {
      return {
        type: 'overdue_tasks',
        raw: cleaned,
      };
    }

    // Check for follow-ups query
    if (QUERY_PATTERNS.followUp.test(cleaned)) {
      return {
        type: 'follow_ups',
        raw: cleaned,
      };
    }

    // Check for client tasks query
    const tasksMatch = cleaned.match(QUERY_PATTERNS.clientTasks);
    if (tasksMatch) {
      return {
        type: 'client_tasks',
        clientName: tasksMatch[1].trim(),
        raw: cleaned,
      };
    }

    // Check for client emails query
    const emailsMatch = cleaned.match(QUERY_PATTERNS.clientEmails);
    if (emailsMatch) {
      return {
        type: 'client_emails',
        clientName: emailsMatch[1].trim(),
        raw: cleaned,
      };
    }

    // Check for client meetings query
    const meetingsMatch = cleaned.match(QUERY_PATTERNS.clientMeetings);
    if (meetingsMatch) {
      return {
        type: 'client_meetings',
        clientName: meetingsMatch[1].trim(),
        raw: cleaned,
      };
    }

    // Check for risk review query
    const riskMatch = cleaned.match(QUERY_PATTERNS.riskReview);
    if (riskMatch) {
      return {
        type: 'risk_review',
        clientName: riskMatch[1].trim(),
        raw: cleaned,
      };
    }

    // Default to unknown
    return {
      type: 'unknown',
      raw: cleaned,
    };
  }

  isRileyMention(text: string): boolean {
    return /@riley\b/i.test(text);
  }
}

export const createParser = (): RileyParser => {
  return new RileyParser();
};
