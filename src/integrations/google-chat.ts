import axios, { AxiosInstance } from 'axios';
import { GoogleChatMessage, RileyResponse } from '../utils/types';
import { getJWTAuth } from '../utils/jwt-auth';

export interface SpaceMember {
  userName: string;
  displayName: string;
}

const MEMBER_CACHE_MS = 10 * 60 * 1000;

export class GoogleChatIntegration {
  private client: AxiosInstance;
  private jwtAuth = getJWTAuth();
  private memberCache = new Map<string, { at: number; members: SpaceMember[] }>();

  constructor() {
    // Base client without auth - auth added per-request
    this.client = axios.create({
      baseURL: 'https://chat.googleapis.com/v1',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  parseMessage(payload: GoogleChatMessage): { text: string; threadName?: string; userId?: string; userEmail?: string; userName?: string } | null {
    if (!payload.message) {
      return null;
    }

    return {
      text: payload.message.text || payload.message.argumentText || '',
      threadName: payload.message.thread?.name,
      userId: payload.message.sender?.name,
      userEmail: payload.message.sender?.email,
      userName: payload.message.sender?.displayName,
    };
  }

  async sendMessage(spaceName: string, message: RileyResponse): Promise<boolean> {
    try {
      // Ensure spaceName doesn't have "spaces/" prefix already
      const cleanSpaceName = spaceName.startsWith('spaces/') ? spaceName : `spaces/${spaceName}`;

      // Get JWT token for authentication
      const token = await this.jwtAuth.getAccessToken();

      await this.client.post(`/${cleanSpaceName}/messages`, {
        text: message.text,
        thread: message.thread,
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      return true;
    } catch (error) {
      console.error('Error sending message to Google Chat:', error);
      return false;
    }
  }

  async listSpaceMembers(spaceName: string): Promise<SpaceMember[]> {
    const cached = this.memberCache.get(spaceName);
    if (cached && Date.now() - cached.at < MEMBER_CACHE_MS) return cached.members;

    try {
      const cleanSpaceName = spaceName.startsWith('spaces/') ? spaceName : `spaces/${spaceName}`;
      const token = await this.jwtAuth.getAccessToken();
      const members: SpaceMember[] = [];
      let pageToken: string | undefined;
      do {
        const { data } = await this.client.get(`/${cleanSpaceName}/members`, {
          headers: { 'Authorization': `Bearer ${token}` },
          params: { pageSize: 1000, pageToken },
        });
        for (const membership of data.memberships || []) {
          const member = membership.member;
          if (member?.type !== 'BOT' && member?.name && member?.displayName) {
            members.push({ userName: member.name, displayName: member.displayName });
          }
        }
        pageToken = data.nextPageToken;
      } while (pageToken);

      this.memberCache.set(spaceName, { at: Date.now(), members });
      return members;
    } catch (error) {
      console.error('Error listing Google Chat space members:', error);
      return [];
    }
  }

  async postMessage(spaceName: string, text: string): Promise<{ name: string; threadName: string } | null> {
    try {
      const cleanSpaceName = spaceName.startsWith('spaces/') ? spaceName : `spaces/${spaceName}`;
      const token = await this.jwtAuth.getAccessToken();

      const { data } = await this.client.post(`/${cleanSpaceName}/messages`, { text }, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      return { name: data.name, threadName: data.thread?.name };
    } catch (error) {
      console.error('Error posting message to Google Chat:', error);
      return null;
    }
  }

  async sendThreadReply(spaceName: string, threadName: string, message: string): Promise<boolean> {
    try {
      // Ensure spaceName doesn't have "spaces/" prefix already
      const cleanSpaceName = spaceName.startsWith('spaces/') ? spaceName : `spaces/${spaceName}`;

      // Get JWT token for authentication
      const token = await this.jwtAuth.getAccessToken();

      await this.client.post(`/${cleanSpaceName}/messages`, {
        text: message,
        thread: {
          name: threadName,
        },
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      return true;
    } catch (error) {
      console.error('Error sending thread reply to Google Chat:', error);
      return false;
    }
  }
}

export const createGoogleChatIntegration = (): GoogleChatIntegration => {
  return new GoogleChatIntegration();
};
