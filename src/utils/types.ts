// Google Chat webhook event types
export interface GoogleChatMessage {
  type: string;
  eventId?: string;
  eventTime?: string;
  message?: {
    name: string;
    sender: {
      name: string;
      displayName: string;
      email: string;
      avatarUrl: string;
    };
    createTime: string;
    text?: string;
    thread?: {
      name: string;
    };
    space?: {
      name: string;
      displayName: string;
      type: string;
    };
    argumentText?: string;
    attachments?: any[];
  };
  user?: {
    name: string;
    displayName: string;
    email: string;
    avatarUrl: string;
  };
  configCompleteRedirectUrl?: string;
}

export interface RileyResponse {
  text?: string;
  thread?: {
    name: string;
  };
}

// Vribble types
export interface VribbleMeeting {
  id: string;
  company_name: string;
  meeting_date: string;
  meeting_duration: number;
  meeting_transcript?: string;
  meeting_summary?: string;
  action_items?: string;
}

// Donezy types
export interface DonezyTask {
  id: string;
  title: string;
  description?: string;
  project_name?: string;
  status: 'todo' | 'in_progress' | 'completed' | 'blocked' | 'awaiting_feedback_internal' | 'awaiting_feedback_external' | 'done' | 'backlog';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assigned_to: string;
  due_date?: string;
  created_at: string;
  updated_at: string;
  days_overdue?: number;
}

// HubSpot types
export interface HubSpotContact {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  phone: string;
  lastmodifieddate: string;
  hs_lead_status?: string;
}

export interface HubSpotDeal {
  id: string;
  dealname: string;
  dealstage: string;
  amount: number;
  closedate?: string;
  associated_company: string;
  lastactivitydate?: string;
}

// Riley query types
export interface RileyQuery {
  type: 'client_status' | 'overdue_tasks' | 'project_status' | 'follow_ups' | 'client_tasks' | 'client_emails' | 'client_meetings' | 'risk_review' | 'unknown';
  clientName?: string;
  projectName?: string;
  raw: string;
}

// Audit log types
export interface AuditLog {
  timestamp: string;
  user_email: string;
  user_name: string;
  query_type: string;
  query_text: string;
  response_summary: string;
  data_sources: string[];
  integration_calls: IntegrationCall[];
}

export interface IntegrationCall {
  service: 'vribble' | 'donezy' | 'hubspot' | 'google_chat';
  endpoint: string;
  status: 'success' | 'failed';
  response_time_ms: number;
  error?: string;
}

// Config types
export interface RileyConfig {
  nodeEnv: string;
  port: number;
  googleChatWebhookSecret?: string;
  vribble: {
    url: string;
    key: string;
  };
  donezy: {
    url: string;
    key: string;
  };
  hubspot: {
    apiKey: string;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}
