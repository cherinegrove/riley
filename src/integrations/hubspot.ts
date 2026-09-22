import axios, { AxiosInstance } from 'axios';
import { HubSpotContact, HubSpotDeal } from '../utils/types';

export class HubSpotIntegration {
  private client: AxiosInstance;

  constructor(apiKey: string) {
    this.client = axios.create({
      baseURL: 'https://api.hubapi.com',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async getContactByEmail(email: string): Promise<HubSpotContact | null> {
    try {
      const { data } = await this.client.post(`/crm/v3/objects/contacts/search`, {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'email',
                operator: 'EQ',
                value: email,
              },
            ],
          },
        ],
        limit: 1,
      });

      if (data.results && data.results.length > 0) {
        const contact = data.results[0];
        return {
          id: contact.id,
          email: contact.properties.email,
          firstname: contact.properties.firstname,
          lastname: contact.properties.lastname,
          phone: contact.properties.phone,
          lastmodifieddate: contact.properties.lastmodifieddate,
          hs_lead_status: contact.properties.hs_lead_status,
        };
      }

      return null;
    } catch (error) {
      console.error('Error fetching contact from HubSpot:', error);
      return null;
    }
  }

  async getCompanyLastContacted(companyName: string): Promise<{
    lastContacted: string | null;
    meetingSummary: string | null;
    meetings: Array<{ id: string; title: string; date: string; summary: string; actionItems: string[] }>;
    emailNotReplied: boolean;
    unrepliedEmails: Array<{ subject: string; date: string; from: string }>;
  }> {
    try {
      // Normalize: trim whitespace
      const normalized = companyName.trim();
      console.log(`[HubSpot] Searching for company: "${normalized}"`);

      // Search with EQ (case-insensitive exact match)
      const { data } = await this.client.post(`/crm/v3/objects/companies/search`, {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'name',
                operator: 'EQ',
                value: normalized,
              },
            ],
          },
        ],
        limit: 1,
        properties: ['notes_last_contacted'],
      });

      console.log(`[HubSpot] Search results count: ${data.results?.length || 0}`);

      if (!data.results || data.results.length === 0) {
        console.log(`[HubSpot] No company found for "${normalized}"`);
        return { lastContacted: null, meetingSummary: null, meetings: [], emailNotReplied: false, unrepliedEmails: [] };
      }

      const company = data.results[0];
      const companyId = company.id;
      console.log(`[HubSpot] Found company ID: ${companyId}`);
      const lastContacted = company.properties.notes_last_contacted || null;
      console.log(`[HubSpot] Last contacted: ${lastContacted}`);

      // Fetch associated meetings via associations API
      let meetingSummary: string | null = null;
      const meetings: Array<{ id: string; title: string; date: string; summary: string; actionItems: string[] }> = [];
      let emailNotReplied = false;
      let unrepliedEmails: Array<{ subject: string; date: string; from: string }> = [];

      try {
        console.log(`[HubSpot] Fetching meetings for company ${companyId}`);
        const { data: assocData } = await this.client.get(
          `/crm/v3/objects/companies/${companyId}/associations/meetings`,
        );

        console.log(`[HubSpot] Associated meetings count: ${assocData.results?.length || 0}`);

        if (assocData.results && assocData.results.length > 0) {
          // Get details for all meetings
          for (const meeting of assocData.results.slice(0, 5)) {
            try {
              const { data: meetingData } = await this.client.get(
                `/crm/v3/objects/meetings/${meeting.id}`,
                {
                  params: {
                    properties: ['hs_meeting_body', 'hs_meeting_title', 'hs_meeting_summary', 'hs_meeting_date', 'notes', 'hs_meeting_transcript'],
                  },
                }
              );

              if (meetingData.properties) {
                const summary = meetingData.properties.hs_meeting_summary || meetingData.properties.notes || meetingData.properties.hs_meeting_body || 'No summary';
                const transcript = meetingData.properties.hs_meeting_transcript || '';

                // Extract action items from transcript
                const actionItems = this.extractActionItems(transcript || summary);
                console.log(`[HubSpot] Meeting "${meetingData.properties.hs_meeting_title}" - extracted ${actionItems.length} action items:`, actionItems);

                meetings.push({
                  id: meeting.id,
                  title: meetingData.properties.hs_meeting_title || 'Untitled Meeting',
                  date: meetingData.properties.hs_meeting_date || new Date().toISOString(),
                  summary,
                  actionItems,
                });
              }
            } catch (meetingError) {
              console.warn(`[HubSpot] Error fetching meeting ${meeting.id}:`, meetingError);
            }
          }

          // Use most recent for summary
          if (meetings.length > 0) {
            meetingSummary = meetings[0].summary;
          }
        }

        // Fetch email activities to find unreplied emails
        try {
          const { data: activitiesData } = await this.client.get(
            `/crm/v3/objects/companies/${companyId}/associations/emails`,
          );

          if (activitiesData.results && activitiesData.results.length > 0) {
            // Get all emails with full details
            const allEmails = [];
            for (const emailAssoc of activitiesData.results.slice(0, 10)) {
              try {
                const { data: emailData } = await this.client.get(
                  `/crm/v3/objects/emails/${emailAssoc.id}`,
                  {
                    params: {
                      properties: ['subject', 'hs_email_direction', 'hs_email_from', 'hs_email_to', 'hs_timestamp', 'hs_email_status', 'hs_email_thread_id'],
                    },
                  }
                );

                allEmails.push({
                  id: emailAssoc.id,
                  direction: emailData.properties?.hs_email_direction,
                  subject: emailData.properties?.subject || 'No subject',
                  timestamp: emailData.properties?.hs_timestamp,
                  from: emailData.properties?.hs_email_from,
                  to: emailData.properties?.hs_email_to,
                  status: emailData.properties?.hs_email_status,
                  threadId: emailData.properties?.hs_email_thread_id,
                });
              } catch (emailError) {
                console.warn(`[HubSpot] Error fetching email ${emailAssoc.id}:`, emailError);
              }
            }

            // Find incoming emails that don't have matching outgoing replies
            const incomingEmails = allEmails.filter((e) => e.direction === 'INCOMING_EMAIL');
            const outgoingEmails = allEmails.filter((e) => e.direction === 'OUTGOING_EMAIL');

            for (const incoming of incomingEmails) {
              // Check if there's an outgoing email in response to this one
              const hasReply = outgoingEmails.some((outgoing) => {
                // Same thread OR subject includes "Re:"
                const sameThread = incoming.threadId && outgoing.threadId && incoming.threadId === outgoing.threadId;
                const replySubject = outgoing.subject?.includes('Re:') && outgoing.subject.includes(incoming.subject?.replace(/^Re: /, '') || '');
                const outgoingAfter = new Date(outgoing.timestamp) > new Date(incoming.timestamp);
                return (sameThread || replySubject) && outgoingAfter;
              });

              if (!hasReply) {
                unrepliedEmails.push({
                  subject: incoming.subject,
                  date: incoming.timestamp,
                  from: incoming.from,
                });
              }
            }

            console.log(`[HubSpot] Email analysis: ${incomingEmails.length} incoming, ${outgoingEmails.length} outgoing, ${unrepliedEmails.length} unreplied`);
          }

          // Set emailNotReplied flag if we found unreplied emails
          emailNotReplied = unrepliedEmails.length > 0;
        } catch (emailError) {
          console.warn('[HubSpot] Could not fetch email associations:', emailError);
        }
      } catch (assocError) {
        console.error('[HubSpot] Error fetching meeting associations:', assocError);
      }

      console.log(`[HubSpot] Extracted ${meetings.length} meetings with action items`);
      return { lastContacted, meetingSummary, meetings, emailNotReplied, unrepliedEmails };
    } catch (error) {
      console.error('Error fetching company last activity:', error);
      return { lastContacted: null, meetingSummary: null, meetings: [], emailNotReplied: false, unrepliedEmails: [] };
    }
  }

  async getDealsByCompanyName(companyName: string): Promise<HubSpotDeal[]> {
    try {
      const { data } = await this.client.post(`/crm/v3/objects/deals/search`, {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'associated_company',
                operator: 'CONTAINS_TOKEN',
                value: companyName,
              },
            ],
          },
        ],
        limit: 10,
        properties: ['dealname', 'dealstage', 'amount', 'closedate', 'hs_lastactivity'],
      });

      return (
        data.results?.map((deal: any) => ({
          id: deal.id,
          dealname: deal.properties.dealname,
          dealstage: deal.properties.dealstage,
          amount: deal.properties.amount ? parseFloat(deal.properties.amount) : 0,
          closedate: deal.properties.closedate,
          associated_company: companyName,
          lastactivitydate: deal.properties.hs_lastactivity,
        })) || []
      );
    } catch (error) {
      console.error('Error fetching deals:', error);
      return [];
    }
  }

  async getAllDeals(limit: number = 50): Promise<HubSpotDeal[]> {
    try {
      const { data } = await this.client.get(`/crm/v3/objects/deals`, {
        params: {
          limit,
          properties: ['dealname', 'dealstage', 'amount', 'closedate', 'associated_company', 'hs_lastactivity'],
        },
      });

      return (
        data.results?.map((deal: any) => ({
          id: deal.id,
          dealname: deal.properties.dealname,
          dealstage: deal.properties.dealstage,
          amount: deal.properties.amount ? parseFloat(deal.properties.amount) : 0,
          closedate: deal.properties.closedate,
          associated_company: deal.properties.associated_company,
          lastactivitydate: deal.properties.hs_lastactivity,
        })) || []
      );
    } catch (error) {
      console.error('Error fetching all deals:', error);
      return [];
    }
  }

  async getAllContacts(limit: number = 50): Promise<HubSpotContact[]> {
    try {
      const { data } = await this.client.get(`/crm/v3/objects/contacts`, {
        params: {
          limit,
          properties: ['email', 'firstname', 'lastname', 'phone', 'hs_lead_status'],
        },
      });

      return (
        data.results?.map((contact: any) => ({
          id: contact.id,
          email: contact.properties.email,
          firstname: contact.properties.firstname,
          lastname: contact.properties.lastname,
          phone: contact.properties.phone,
          lastmodifieddate: contact.properties.lastmodifieddate,
          hs_lead_status: contact.properties.hs_lead_status,
        })) || []
      );
    } catch (error) {
      console.error('Error fetching all contacts:', error);
      return [];
    }
  }

  private extractActionItems(text: string): string[] {
    if (!text) return [];

    const lines = text.split('\n');
    const actionItems: string[] = [];

    // Look for lines that contain action items
    // Patterns: "• Action:", "TODO:", "Action item:", "Action:", "- Action", bullet points with action-like text
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.match(/^[\s•\-\*]*action/i) ||
        trimmed.match(/^[\s•\-\*]*todo/i) ||
        trimmed.match(/^[\s•\-\*]*follow.{0,3}up/i) ||
        trimmed.match(/^[\s•\-\*]*deliverable/i) ||
        (trimmed.startsWith('•') && trimmed.length > 3) ||
        (trimmed.startsWith('-') && trimmed.length > 3 && !trimmed.match(/^-{2,}/))
      ) {
        // Clean up the line
        const cleaned = trimmed.replace(/^[\s•\-\*]+/, '').trim();
        if (cleaned.length > 5) {
          actionItems.push(cleaned);
        }
      }
    }

    return actionItems;
  }
}

export const createHubSpotIntegration = (apiKey: string): HubSpotIntegration => {
  return new HubSpotIntegration(apiKey);
};
