import pino from 'pino';
import { AuditLog, IntegrationCall } from '../utils/types';

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
  },
  pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  })
);

export class RileyLogger {
  private auditLog: AuditLog | null = null;

  startAuditLog(userName: string, userEmail: string, queryText: string, queryType: string) {
    this.auditLog = {
      timestamp: new Date().toISOString(),
      user_email: userEmail,
      user_name: userName,
      query_type: queryType,
      query_text: queryText,
      response_summary: '',
      data_sources: [],
      integration_calls: [],
    };
  }

  addDataSource(source: string) {
    if (this.auditLog) {
      this.auditLog.data_sources.push(source);
    }
  }

  addIntegrationCall(call: IntegrationCall) {
    if (this.auditLog) {
      this.auditLog.integration_calls.push(call);
    }
  }

  setResponseSummary(summary: string) {
    if (this.auditLog) {
      this.auditLog.response_summary = summary;
    }
  }

  getAuditLog(): AuditLog | null {
    return this.auditLog;
  }

  info(msg: string, data?: any) {
    logger.info(data || {}, msg);
  }

  error(msg: string, error?: any) {
    logger.error(error || {}, msg);
  }

  warn(msg: string, data?: any) {
    logger.warn(data || {}, msg);
  }

  debug(msg: string, data?: any) {
    logger.debug(data || {}, msg);
  }
}

export const createLogger = (): RileyLogger => {
  return new RileyLogger();
};
