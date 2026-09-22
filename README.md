# Riley - Interactive PM Bot for Google Chat

Riley is a Node.js + Express-based PM bot that responds to mentions in Google Chat and provides intelligent summaries from Vribble, Donezy, and HubSpot.

## Architecture

```
riley/
├── src/
│   ├── server.ts                 # Express + Google Chat webhook handler
│   ├── integrations/
│   │   ├── vribble.ts           # Meeting queries from Vribble
│   │   ├── donezy.ts            # Task queries from Donezy
│   │   ├── hubspot.ts           # CRM queries from HubSpot
│   │   └── google-chat.ts       # Message parsing and sending
│   ├── riley/
│   │   ├── parser.ts            # Parse @Riley queries
│   │   ├── responder.ts         # Generate responses
│   │   └── logger.ts            # Audit trail & logging
│   └── utils/
│       ├── config.ts            # Configuration management
│       └── types.ts             # TypeScript type definitions
├── .env.example                 # Example environment variables
├── package.json
├── tsconfig.json
└── railway.json                 # Railway deployment config
```

## MVP Capabilities

Riley responds to the following @Riley mentions in Google Chat:

### 1. Client Status
```
@Riley how are we doing on [Client Name]?
```
Returns:
- Last contacted date (from HubSpot)
- Recent meetings (from Vribble)
- Active tasks (from Donezy)
- Deal status (from HubSpot)

### 2. Overdue Tasks
```
@Riley what's overdue?
```
Returns:
- All tasks overdue by more than 7 days
- Ranked by days overdue
- Includes assignee and priority

### 3. Project Status
```
@Riley status on [Project Name]?
```
Returns:
- Progress percentage
- Tasks grouped by status
- Key blockers

### 4. Follow-up Contacts
```
@Riley who needs a follow-up?
```
Returns:
- Contacts without activity in past 7 days
- Associated deals
- Ranked by staleness

## Setup

### 1. Install Dependencies
```bash
cd /c/Users/cheri/Projects/riley
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
- **Vribble**: Supabase URL and key (rkusqxihbkypuyjnftni)
- **Donezy**: Supabase URL and key (puwxkygdlclcbyxrtppd)
- **HubSpot**: API key (from HubSpot settings)
- **Google Chat**: Webhook secret (optional)

### 3. Development
```bash
npm run dev
```

Server runs on `http://localhost:3000`

### 4. Build
```bash
npm run build
```

## Deployment to Railway

### First Time Setup
1. Login to Railway: `railway login`
2. Create new project: `railway init`
3. Link to Riley service
4. Set environment variables via Railway dashboard

### Environment Variables on Railway
Copy all values from `.env`:
- `VRIBBLE_SUPABASE_URL`
- `VRIBBLE_SUPABASE_KEY`
- `DONEZY_SUPABASE_URL`
- `DONEZY_SUPABASE_KEY`
- `HUBSPOT_API_KEY`
- `LOG_LEVEL` (optional, defaults to `info`)

### Deploy
```bash
railway up
```

The service will be deployed to Railway at a URL like:
```
https://riley-production.up.railway.app
```

## Google Chat Integration

### Get Webhook URL
After deployment, your webhook endpoint is:
```
https://[YOUR_RAILWAY_URL]/webhook/google-chat
```

### Create Google Chat Bot
1. Go to your Google Chat space
2. Click "Apps & integrations"
3. Click "Create or search apps"
4. Click "Create a new app"
5. Select "Webhook"
6. Paste the webhook URL above
7. Test with `@Riley how are we doing on [your-client]?`

## Endpoints

### POST `/webhook/google-chat`
Receives Google Chat message payloads with @Riley mentions

**Example Response:**
```json
{
  "status": "ok"
}
```

### GET `/health`
Health check endpoint

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-09-21T10:30:00Z"
}
```

### GET `/config`
Debug endpoint showing configuration status

**Response:**
```json
{
  "environment": "production",
  "port": 3000,
  "integrations": {
    "vribble": true,
    "donezy": true,
    "hubspot": true
  }
}
```

## Logging & Audit Trail

Riley automatically logs:
- User information (email, name)
- Query type and text
- Data sources accessed
- Integration calls (success/failure, response time)
- Response summary

Logs are available in Railway logs and locally in development.

## Error Handling

Riley gracefully handles:
- Missing/invalid credentials
- API failures from integrations
- Invalid query formats
- Malformed Google Chat messages

## Future Enhancements

The architecture is designed to support:
- **Teams/Slack support**: New webhook handlers in `server.ts`
- **HubSpot logging sync**: Hook in `responder.ts` to log interactions
- **Custom commands**: Extend `parser.ts` with new query types
- **Scheduled reports**: Add cron jobs for daily/weekly summaries

## Development Notes

- TypeScript for type safety
- Modular integration structure for easy expansion
- Comprehensive audit logging for compliance
- Pino logger for structured logging
- Zod for configuration validation

## Support

For issues or questions:
1. Check Railway logs: `railway logs`
2. Review local development: `npm run dev`
3. Validate integrations: `GET /config`
4. Check .env variables: `cat .env` (don't commit!)

---

**Status**: MVP ready for deployment (Sept 21)  
**Timeline**: Live by Oct 1  
**Owner**: Cherine Grove
