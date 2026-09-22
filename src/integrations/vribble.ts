import { createClient } from '@supabase/supabase-js';
import { VribbleMeeting } from '../utils/types';

export class VribbleIntegration {
  private supabase: ReturnType<typeof createClient>;

  constructor(url: string, key: string) {
    this.supabase = createClient(url, key);
  }

  async getMeetingsByClientName(clientName: string): Promise<VribbleMeeting[]> {
    try {
      const { data, error } = await this.supabase
        .from('meetings')
        .select('*')
        .ilike('company_name', `%${clientName}%`)
        .order('meeting_date', { ascending: false })
        .limit(10);

      if (error) throw error;

      return (
        data?.map((row: any) => ({
          id: row.id,
          company_name: row.company_name,
          meeting_date: row.meeting_date,
          meeting_duration: row.meeting_duration,
          meeting_transcript: row.meeting_transcript,
          meeting_summary: row.meeting_summary,
          action_items: row.action_items,
        })) || []
      );
    } catch (error) {
      console.error('Error fetching Vribble meetings:', error);
      return [];
    }
  }

  async getRecentMeetings(limit: number = 20): Promise<VribbleMeeting[]> {
    try {
      const { data, error } = await this.supabase
        .from('meetings')
        .select('*')
        .order('meeting_date', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (
        data?.map((row: any) => ({
          id: row.id,
          company_name: row.company_name,
          meeting_date: row.meeting_date,
          meeting_duration: row.meeting_duration,
          meeting_transcript: row.meeting_transcript,
          meeting_summary: row.meeting_summary,
          action_items: row.action_items,
        })) || []
      );
    } catch (error) {
      console.error('Error fetching recent Vribble meetings:', error);
      return [];
    }
  }
}

export const createVribbleIntegration = (url: string, key: string): VribbleIntegration => {
  return new VribbleIntegration(url, key);
};
