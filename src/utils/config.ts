import { RileyConfig } from './types';

export const getConfig = (): RileyConfig => {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    googleChatWebhookSecret: process.env.GOOGLE_CHAT_WEBHOOK_SECRET,
    vribble: {
      url: process.env.VRIBBLE_SUPABASE_URL || '',
      key: process.env.VRIBBLE_SUPABASE_KEY || '',
    },
    donezy: {
      url: process.env.DONEZY_SUPABASE_URL || '',
      key: process.env.DONEZY_SUPABASE_KEY || '',
    },
    hubspot: {
      apiKey: process.env.HUBSPOT_API_KEY || '',
    },
    logging: {
      level: (process.env.LOG_LEVEL as any) || 'info',
    },
  };
};

export const validateConfig = (config: RileyConfig): string[] => {
  const errors: string[] = [];

  if (!config.vribble.url || !config.vribble.key) {
    errors.push('Missing Vribble Supabase credentials');
  }
  if (!config.donezy.url || !config.donezy.key) {
    errors.push('Missing Donezy Supabase credentials');
  }
  if (!config.hubspot.apiKey) {
    errors.push('Missing HubSpot API key');
  }

  return errors;
};
