import axios, { AxiosInstance } from 'axios';
import { GoogleChatMessage, RileyResponse } from '../utils/types';
import { getJWTAuth } from '../utils/jwt-auth';

export class GoogleChatIntegration {
  private client: AxiosInstance;
  private jwtAuth = getJWTAuth();

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
