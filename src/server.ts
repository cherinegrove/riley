import express, { Express, Request, Response } from 'express';
import { getConfig, validateConfig } from './utils/config';
import { createDonezyIntegration } from './integrations/donezy';
import { createHubSpotIntegration } from './integrations/hubspot';
import { createGoogleChatIntegration } from './integrations/google-chat';
import { createParser } from './riley/parser';
import { createResponder, ResponseData } from './riley/responder';
import { createLogger } from './riley/logger';
import { createDailyDigest } from './riley/daily-digest';
import { createRileyStore } from './integrations/riley-store';
import { MeetingCandidate, MeetingTrigger } from './riley/meeting-trigger';
import { ProposalService } from './riley/proposals';
import { ApprovalService } from './riley/approvals';
import { ProjectReview, ReviewCategory } from './riley/project-review';
import { Assistant } from './riley/assistant';
import { APPROVER_EMAIL } from './riley/approvals';
import { GoogleChatMessage, DONEZY_AWAITING_EXTERNAL, DONEZY_AWAITING_INTERNAL } from './utils/types';

const app: Express = express();
const config = getConfig();

// Validate configuration
const configErrors = validateConfig(config);
if (configErrors.length > 0) {
  console.error('Configuration errors:');
  configErrors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Initialize integrations
const donezy = createDonezyIntegration(config.donezy.url, config.donezy.key);
const hubspot = createHubSpotIntegration(config.hubspot.apiKey);
const googleChat = createGoogleChatIntegration();
const assistant = new Assistant(process.env.ANTHROPIC_API_KEY, donezy, hubspot);
const rileyStore = createRileyStore();
const proposals = new ProposalService(rileyStore, googleChat, donezy);
const approvals = new ApprovalService(rileyStore, donezy);
const meetingTrigger = new MeetingTrigger(config.vribble.url, config.vribble.key, rileyStore, (candidate: MeetingCandidate) =>
  proposals.propose(candidate)
);
meetingTrigger.start(30 * 60 * 1000);
const projectReview = new ProjectReview(rileyStore, googleChat, donezy);
projectReview.start();

// Initialize utilities
const parser = createParser();
const responder = createResponder();
const logger = createLogger();

/**
 * Google Chat webhook endpoint handler
 * Receives messages and processes @Riley mentions
 */
const handleGoogleChatWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info('Webhook received');
    const eventPayload = req.body;

    // Handle slash commands
    if (eventPayload.type === 'SLASH_COMMAND') {
      logger.info('Slash command received', { command: eventPayload.command });

      const command = eventPayload.command;
      const arguments_ = eventPayload.arguments?.join(' ') || '';
      const text = `${command} ${arguments_}`.trim();

      // Start audit log
      logger.startAuditLog(eventPayload.user?.displayName || 'unknown', eventPayload.user?.email || 'unknown', text, '');

      // Parse the command
      const query = parser.parse(text);
      logger.info(`Parsed query: ${query.type}`, { query });
      logger.setResponseSummary(`Query type: ${query.type}`);

      // Fetch data and generate response (reuse existing logic)
      const responseData: ResponseData = {};

      // Execute the appropriate query handler (same logic as @Riley mentions)
      if (query.type === 'client_tasks' && query.clientName) {
        logger.addDataSource('donezy');
        const tasks = await donezy.getTasksByClientName(query.clientName);
        responseData.tasks = tasks;
      } else if (query.type === 'client_emails' && query.clientName) {
        logger.addDataSource('hubspot');
        const company = await hubspot.getCompanyLastContacted(query.clientName);
        responseData.unrepliedEmails = company.unrepliedEmails || [];
      } else if (query.type === 'client_meetings' && query.clientName) {
        logger.addDataSource('hubspot');
        const company = await hubspot.getCompanyLastContacted(query.clientName);
        responseData.meetings = company.meetings || [];
      } else if (query.type === 'risk_review' && query.clientName) {
        logger.addDataSource('donezy');

        // Try to match by exact assignee name first
        const allRiskByAssignee = await donezy.getAllRiskTasksGroupedByAssignee();
        let assigneeAtRiskTasks = allRiskByAssignee[query.clientName] || [];

        // If no exact match, try case-insensitive search
        if (assigneeAtRiskTasks.length === 0) {
          const queryLower = query.clientName.toLowerCase();
          const matchingAssignee = Object.keys(allRiskByAssignee).find(
            name => name.toLowerCase() === queryLower
          );
          if (matchingAssignee) {
            assigneeAtRiskTasks = allRiskByAssignee[matchingAssignee];
            logger.info(`Matched "${query.clientName}" to assignee "${matchingAssignee}"`);
          }
        }

        if (assigneeAtRiskTasks.length > 0) {
          // It's an assignee - show their at-risk tasks
          responseData.tasks = assigneeAtRiskTasks;
          responseData.overdueTasks = assigneeAtRiskTasks.filter(t => t.days_overdue && t.days_overdue > 0);
          responseData.staleTasks = assigneeAtRiskTasks.filter(t => {
            const daysSinceUpdate = Math.floor((new Date().getTime() - new Date(t.updated_at).getTime()) / (1000 * 60 * 60 * 24));
            return daysSinceUpdate >= 7 && (!t.days_overdue || t.days_overdue <= 0);
          });
          responseData.awaitingFeedbackTasks = assigneeAtRiskTasks.filter(t =>
            t.status === DONEZY_AWAITING_INTERNAL || t.status === DONEZY_AWAITING_EXTERNAL
          );
        } else {
          // It's a client - show their client-level risk review
          logger.addDataSource('hubspot');
          const company = await hubspot.getCompanyLastContacted(query.clientName);
          responseData.lastContacted = company.lastContacted || undefined;
          responseData.unrepliedEmails = company.unrepliedEmails || [];
          responseData.meetings = company.meetings || [];

          const clientTasks = await donezy.getTasksByClientName(query.clientName);

          // Filter at-risk tasks to only include those for this client
          const allOverdueTasks = await donezy.getOverdueTasks();
          const allStaleTasks = await donezy.getTasksNotUpdatedInDays(7);
          const allAwaitingFeedbackTasks = await donezy.getStaleAwaitingFeedbackTasks();

          const clientNameLower = query.clientName.toLowerCase();
          const overdueTasks = allOverdueTasks.filter(t => t.project_name?.toLowerCase().includes(clientNameLower));
          const staleTasks = allStaleTasks.filter(t => t.project_name?.toLowerCase().includes(clientNameLower));
          const awaitingFeedbackTasks = allAwaitingFeedbackTasks.filter(t => t.project_name?.toLowerCase().includes(clientNameLower));

          responseData.tasks = clientTasks;
          responseData.overdueTasks = overdueTasks;
          responseData.staleTasks = staleTasks;
          responseData.awaitingFeedbackTasks = awaitingFeedbackTasks;
        }
      }

      const responseText = responder.generateResponse(query, responseData);
      logger.info('Response generated', { length: responseText?.length });

      // Return response for slash command
      res.status(200).json({
        text: responseText,
      });
      return;
    }

    // Google Chat sends events in a different format
    if (!eventPayload.chat || !eventPayload.chat.messagePayload) {
      logger.info('Not a chat message event');
      res.status(200).json({});
      return;
    }

    // Extract the actual message from the event
    const payload: GoogleChatMessage = {
      type: 'MESSAGE',
      message: eventPayload.chat.messagePayload.message,
      space: eventPayload.chat.messagePayload.space,
    } as any;

    logger.info('Extracted message payload');

    // Parse the message
    const parsed = googleChat.parseMessage(payload);
    logger.info('Parsed message', { text: parsed?.text });

    if (!parsed || !parsed.text) {
      logger.info('No parsed text found');
      res.status(200).json({});
      return;
    }

    if (parsed.userId && parsed.userEmail) {
      await rileyStore.recordChatUser(parsed.userId, parsed.userEmail, parsed.userName);
    }

    // Check if Riley is mentioned
    const isMentioned = parser.isRileyMention(parsed.text);
    logger.info('Riley mention check', { text: parsed.text, isMentioned });

    if (!isMentioned) {
      logger.info('Riley not mentioned');
      res.status(200).json({});
      return;
    }

    const updateReply = await approvals.handleTaskUpdate(parsed.text, parsed.userEmail);
    if (updateReply) {
      const replyThread = payload.message?.thread?.name;
      await googleChat.sendMessage(payload.message?.space?.name || '', {
        text: updateReply,
        ...(replyThread && { thread: { name: replyThread } }),
      });
      res.status(200).json({});
      return;
    }

    const createReply = await approvals.handleCreateRequest(parsed.text, parsed.userEmail);
    if (createReply) {
      const replyThread = payload.message?.thread?.name;
      await googleChat.sendMessage(payload.message?.space?.name || '', {
        text: createReply,
        ...(replyThread && { thread: { name: replyThread } }),
      });
      res.status(200).json({});
      return;
    }

    const approvalReply = await approvals.handle(
      parsed.text,
      payload.message?.space?.name || '',
      payload.message?.thread?.name,
      parsed.userEmail
    );
    if (approvalReply) {
      const replyThread = payload.message?.thread?.name;
      await googleChat.sendMessage(payload.message?.space?.name || '', {
        text: approvalReply,
        ...(replyThread && { thread: { name: replyThread } }),
      });
      res.status(200).json({});
      return;
    }

    // Start audit log
    logger.startAuditLog(parsed.userName || 'unknown', parsed.userEmail || 'unknown', parsed.text, '');

    // Parse the query
    const query = parser.parse(parsed.text);
    logger.info(`Parsed query: ${query.type}`, { query });

    if (query.type === 'unknown' && assistant.enabled) {
      const isApprover = parsed.userEmail?.toLowerCase() === APPROVER_EMAIL;
      const answer = await assistant.answer(parsed.text.replace(/@riley\b/i, '').trim(), isApprover);
      const replyThread = payload.message?.thread?.name;
      await googleChat.sendMessage(payload.message?.space?.name || '', {
        text: answer,
        ...(replyThread && { thread: { name: replyThread } }),
      });
      res.status(200).json({});
      return;
    }

    // Update audit log with query type
    logger.setResponseSummary(`Query type: ${query.type}`);

    // Fetch data based on query type
    const responseData: ResponseData = {};
    let spaceName = payload.message?.space?.name || '';
    let threadName = payload.message?.thread?.name;
    await rileyStore.recordSpace(spaceName, payload.message?.space?.displayName);

    switch (query.type) {
      case 'client_status': {
        if (query.clientName) {
          logger.addDataSource('hubspot');
          const company = await hubspot.getCompanyLastContacted(query.clientName);
          responseData.lastContacted = company.lastContacted || undefined;
          responseData.meetingSummary = company.meetingSummary || undefined;
          responseData.meetings = company.meetings || [];
          responseData.emailNotReplied = company.emailNotReplied || false;
          responseData.unrepliedEmails = company.unrepliedEmails || [];

          logger.addDataSource('donezy');
          const clientTasks = await donezy.getTasksByClientName(query.clientName);
          const overdueTasks = await donezy.getOverdueTasks();
          const staleTasks = await donezy.getTasksNotUpdatedInDays(7);
          const awaitingFeedbackTasks = await donezy.getStaleAwaitingFeedbackTasks();

          console.log(`[Donezy] Found ${clientTasks.length} tasks for client "${query.clientName}":`, clientTasks.map((t) => t.title));

          responseData.tasks = clientTasks;
          responseData.overdueTasks = overdueTasks;
          responseData.staleTasks = staleTasks;
          responseData.awaitingFeedbackTasks = awaitingFeedbackTasks;
        }
        break;
      }

      case 'project_status': {
        if (query.projectName) {
          logger.addDataSource('donezy');
          const tasks = await donezy.getTasksByProjectName(query.projectName);
          responseData.tasks = tasks;
        }
        break;
      }

      case 'overdue_tasks': {
        logger.addDataSource('donezy');
        const tasks = await donezy.getOverdueTasks();
        responseData.tasks = tasks;
        break;
      }

      case 'follow_ups': {
        logger.addDataSource('hubspot');
        const deals = await hubspot.getAllDeals(100);
        const contacts = await hubspot.getAllContacts(100);
        responseData.deals = deals;
        responseData.contacts = contacts;
        break;
      }

      case 'client_tasks': {
        if (query.clientName) {
          logger.addDataSource('donezy');
          const tasks = await donezy.getTasksByClientName(query.clientName);
          responseData.tasks = tasks;
        }
        break;
      }

      case 'client_emails': {
        if (query.clientName) {
          logger.addDataSource('hubspot');
          const company = await hubspot.getCompanyLastContacted(query.clientName);
          responseData.unrepliedEmails = company.unrepliedEmails || [];
        }
        break;
      }

      case 'client_meetings': {
        if (query.clientName) {
          logger.addDataSource('hubspot');
          const company = await hubspot.getCompanyLastContacted(query.clientName);
          responseData.meetings = company.meetings || [];
        }
        break;
      }

      case 'risk_review': {
        if (query.clientName) {
          logger.addDataSource('donezy');

          // Check if this is an assignee name first
          const assigneeAtRiskTasks = await donezy.getAtRiskTasksForAssignee(query.clientName);

          if (assigneeAtRiskTasks.length > 0) {
            // It's an assignee - show their at-risk tasks
            responseData.tasks = assigneeAtRiskTasks;
            responseData.overdueTasks = assigneeAtRiskTasks.filter(t => t.days_overdue && t.days_overdue > 0);
            responseData.staleTasks = assigneeAtRiskTasks.filter(t => {
              const daysSinceUpdate = Math.floor((new Date().getTime() - new Date(t.updated_at).getTime()) / (1000 * 60 * 60 * 24));
              return daysSinceUpdate >= 7 && (!t.days_overdue || t.days_overdue <= 0);
            });
            responseData.awaitingFeedbackTasks = assigneeAtRiskTasks.filter(t =>
              t.status === DONEZY_AWAITING_INTERNAL || t.status === DONEZY_AWAITING_EXTERNAL
            );
          } else {
            // It's a client - show their client-level risk review
            logger.addDataSource('hubspot');
            const company = await hubspot.getCompanyLastContacted(query.clientName);
            responseData.lastContacted = company.lastContacted || undefined;
            responseData.unrepliedEmails = company.unrepliedEmails || [];
            responseData.meetings = company.meetings || [];

            const clientTasks = await donezy.getTasksByClientName(query.clientName);

            // Filter at-risk tasks to only include those for this client
            const allOverdueTasks = await donezy.getOverdueTasks();
            const allStaleTasks = await donezy.getTasksNotUpdatedInDays(7);
            const allAwaitingFeedbackTasks = await donezy.getStaleAwaitingFeedbackTasks();

            const clientNameLower = query.clientName.toLowerCase();
            const overdueTasks = allOverdueTasks.filter(t => t.project_name?.toLowerCase().includes(clientNameLower));
            const staleTasks = allStaleTasks.filter(t => t.project_name?.toLowerCase().includes(clientNameLower));
            const awaitingFeedbackTasks = allAwaitingFeedbackTasks.filter(t => t.project_name?.toLowerCase().includes(clientNameLower));

            responseData.tasks = clientTasks;
            responseData.overdueTasks = overdueTasks;
            responseData.staleTasks = staleTasks;
            responseData.awaitingFeedbackTasks = awaitingFeedbackTasks;
          }
        }
        break;
      }
    }

    logger.info('Generating response', { queryType: query.type });
    const parts = query.type === 'risk_review'
      ? responder.generateRiskMessages(query.clientName, responseData)
      : [responder.generateResponse(query, responseData)];
    logger.info('Response generated', { parts: parts.length });

    if (spaceName) {
      logger.info('Sending to Google Chat', { spaceName, threadName });
      for (const [index, part] of parts.entries()) {
        const messageData = {
          text: index === 0 ? `*Riley:*\n\n${part}` : part,
          ...(threadName && { thread: { name: threadName } }),
        };
        await googleChat.sendMessage(spaceName, messageData);
      }
      logger.info('Messages sent to Google Chat');
    } else {
      logger.warn('No space name found');
    }

    // Return success to Google Chat
    res.status(200).json({});
  } catch (error) {
    logger.error('Error processing webhook', { error: String(error), stack: error instanceof Error ? error.stack : 'N/A' });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Register webhook routes
app.post('/webhook', handleGoogleChatWebhook);
app.post('/webhook/google-chat', handleGoogleChatWebhook);

/**
 * Health check endpoint
 */
app.post('/test/meeting-trigger', async (_req: Request, res: Response): Promise<void> => {
  const candidates = await meetingTrigger.scan(new Date(), false);
  res.status(200).json({ count: candidates.length, candidates });
});

app.post('/test/repost-proposal/:meetingId', async (req: Request, res: Response): Promise<void> => {
  const candidate = await meetingTrigger.candidateFor(req.params.meetingId);
  if (!candidate || candidate.status !== 'detected') {
    res.status(200).json({ posted: false, status: candidate?.status ?? 'not_found' });
    return;
  }
  const posted = await proposals.propose(candidate);
  res.status(200).json({ posted, space: candidate.space_name, items: candidate.actionItems.length });
});

app.post('/test/project-review/:projectId', async (req: Request, res: Response): Promise<void> => {
  const project = (await donezy.getOpenProjects()).find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'no open project with that id' });
    return;
  }
  const category = (req.query.category as ReviewCategory) || 'overdue';
  const messages = await projectReview.messagesFor(project.id, project.name, category);
  if (req.query.post === 'true') {
    const target = process.env.PROPOSAL_FALLBACK_SPACE || process.env.GOOGLE_CHAT_SPACE_ID || '';
    for (const text of messages) {
      await googleChat.postMessage(target, text);
    }
  }
  res.status(200).json({ project: project.name, messages });
});

app.post('/test/meeting-proposal', async (_req: Request, res: Response): Promise<void> => {
  const candidates = await meetingTrigger.scan(new Date(), false);
  const withActions = candidates.find((c) => c.actionItems.length > 0 && c.status !== 'duplicate');
  if (!withActions) {
    res.status(200).json({ posted: false, reason: 'no meeting with action items' });
    return;
  }
  const posted = await proposals.propose(withActions);
  res.status(200).json({ posted, meeting: withActions.title, items: withActions.actionItems.length });
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Config endpoint (for debugging)
 */
app.get('/config', (_req: Request, res: Response) => {
  res.status(200).json({
    environment: config.nodeEnv,
    port: config.port,
    integrations: {
      vribble: !!config.vribble.url,
      donezy: !!config.donezy.url,
      hubspot: !!config.hubspot.apiKey,
    },
  });
});

/**
 * Test endpoint - manually trigger daily digest
 */
app.post('/test/digest', async (_req: Request, res: Response) => {
  try {
    logger.info('Manual digest test triggered');
    await dailyDigest.runDigest();
    res.status(200).json({
      status: 'success',
      message: 'Daily digest test completed. Check logs for results.',
    });
  } catch (error) {
    logger.error('Digest test failed', { error: String(error) });
    res.status(500).json({
      status: 'error',
      error: String(error),
    });
  }
});

/**
 * Test endpoint - list all assignees with task counts
 */
app.get('/test/assignees', async (_req: Request, res: Response): Promise<void> => {
  try {
    const allTasks = await donezy.getAllTasks();
    const assigneeCounts: { [key: string]: number } = {};

    allTasks.forEach((t) => {
      assigneeCounts[t.assigned_to] = (assigneeCounts[t.assigned_to] || 0) + 1;
    });

    res.status(200).json({
      status: 'success',
      totalTasks: allTasks.length,
      assignees: Object.entries(assigneeCounts)
        .map(([name, count]) => ({ name, taskCount: count }))
        .sort((a, b) => b.taskCount - a.taskCount),
    });
  } catch (error) {
    logger.error('Assignees list failed', { error: String(error) });
    res.status(500).json({
      status: 'error',
      error: String(error),
    });
  }
});

/**
 * Test endpoint - detailed breakdown by status
 */
app.post('/test/digest-detailed/:assignee', async (req: Request, res: Response): Promise<void> => {
  try {
    const assignee = req.params.assignee;
    const allRiskTasks = await donezy.getAllRiskTasksGroupedByAssignee();
    const assigneeTasks = allRiskTasks[assignee] || [];

    if (assigneeTasks.length === 0) {
      res.status(200).json({
        assignee,
        status: 'no_at_risk_tasks',
        message: `No at-risk tasks found for ${assignee}`,
      });
      return;
    }

    const now = new Date();

    // Categorize by risk type
    const overdue = assigneeTasks.filter((t) => t.days_overdue && t.days_overdue > 0);
    const awaitingFeedbackInternal = assigneeTasks.filter((t) => t.status === DONEZY_AWAITING_INTERNAL);
    const awaitingFeedbackExternal = assigneeTasks.filter((t) => t.status === DONEZY_AWAITING_EXTERNAL);
    const stale = assigneeTasks.filter((t) => {
      const daysSinceUpdate = Math.floor((now.getTime() - new Date(t.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      return daysSinceUpdate >= 7 && !t.days_overdue;
    });

    res.status(200).json({
      assignee,
      status: 'success',
      totalAtRiskTasks: assigneeTasks.length,
      breakdown: {
        overdue: overdue.map((t) => ({
          title: t.title,
          status: 'OVERDUE',
          daysOverdue: t.days_overdue,
          dueDate: t.due_date,
          project: t.project_name,
          category: `${t.days_overdue} days past due`,
        })),
        awaitingFeedbackInternal: awaitingFeedbackInternal.map((t) => {
          const hoursSinceUpdate = Math.floor((now.getTime() - new Date(t.updated_at).getTime()) / (1000 * 60 * 60));
          return {
            title: t.title,
            status: 'AWAITING FEEDBACK (Internal)',
            hoursSinceUpdate,
            lastUpdated: t.updated_at,
            project: t.project_name,
            category: `Waiting ${hoursSinceUpdate}h for internal feedback`,
          };
        }),
        awaitingFeedbackExternal: awaitingFeedbackExternal.map((t) => {
          const hoursSinceUpdate = Math.floor((now.getTime() - new Date(t.updated_at).getTime()) / (1000 * 60 * 60));
          return {
            title: t.title,
            status: 'AWAITING FEEDBACK (External)',
            hoursSinceUpdate,
            lastUpdated: t.updated_at,
            project: t.project_name,
            category: `Waiting ${hoursSinceUpdate}h for external feedback`,
          };
        }),
        stale: stale.map((t) => {
          const daysSinceUpdate = Math.floor((now.getTime() - new Date(t.updated_at).getTime()) / (1000 * 60 * 60 * 24));
          return {
            title: t.title,
            status: t.status,
            daysSinceUpdate,
            lastUpdated: t.updated_at,
            project: t.project_name,
            category: `Not updated for ${daysSinceUpdate} days`,
          };
        }),
      },
    });
  } catch (error) {
    logger.error('Detailed digest failed', { error: String(error) });
    res.status(500).json({
      status: 'error',
      error: String(error),
    });
  }
});

/**
 * Test endpoint - check at-risk tasks for a specific person
 */
app.post('/test/digest/:assignee', async (req: Request, res: Response): Promise<void> => {
  try {
    const assignee = req.params.assignee;
    logger.info(`Testing digest for assignee: ${assignee}`);

    // Fetch tasks for this assignee
    const allTasks = await donezy.getAllTasks();
    const assigneeTasks = allTasks.filter((t) => t.assigned_to === assignee);

    if (assigneeTasks.length === 0) {
      res.status(200).json({
        assignee,
        status: 'no_tasks',
        message: `No tasks found for ${assignee}`,
      });
      return;
    }

    // Filter for at-risk tasks
    const now = new Date();
    const atRiskTasks = assigneeTasks.filter((task) => {
      // Check if overdue
      if (task.days_overdue && task.days_overdue > 0) return true;

      // Check if awaiting feedback 24+ hours
      if (task.status === DONEZY_AWAITING_INTERNAL || task.status === DONEZY_AWAITING_EXTERNAL) {
        const hoursSinceUpdate = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60));
        if (hoursSinceUpdate >= 24) return true;
      }

      // Check if not updated in 7+ days
      const daysSinceUpdate = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceUpdate >= 7) return true;

      return false;
    });

    // Group by risk type
    const overdue = atRiskTasks.filter((t) => t.days_overdue && t.days_overdue > 0);
    const stale = atRiskTasks.filter((t) => {
      const daysSinceUpdate = Math.floor((now.getTime() - new Date(t.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      return daysSinceUpdate >= 7;
    });
    const awaitingFeedback = atRiskTasks.filter(
      (t) => t.status === DONEZY_AWAITING_INTERNAL || t.status === DONEZY_AWAITING_EXTERNAL
    );

    res.status(200).json({
      assignee,
      status: 'success',
      totalTasks: assigneeTasks.length,
      atRiskCount: atRiskTasks.length,
      breakdown: {
        overdue: overdue.map((t) => ({ title: t.title, project: t.project_name, daysOverdue: t.days_overdue })),
        awaitingFeedback: awaitingFeedback.map((t) => ({ title: t.title, project: t.project_name, status: t.status })),
        stale: stale.map((t) => {
          const daysSinceUpdate = Math.floor((now.getTime() - new Date(t.updated_at).getTime()) / (1000 * 60 * 60 * 24));
          return { title: t.title, project: t.project_name, daysSinceUpdate };
        }),
      },
    });
  } catch (error) {
    logger.error('Assignee digest test failed', { error: String(error) });
    res.status(500).json({
      status: 'error',
      error: String(error),
    });
  }
});

// Initialize daily digest scheduler
const dailyDigest = createDailyDigest(donezy);
dailyDigest.start();

// Start server
const PORT = config.port;
app.listen(PORT, () => {
  logger.info(`Riley PM Bot started on port ${PORT}`);
  logger.info(`Webhook endpoint: http://localhost:${PORT}/webhook/google-chat`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});
