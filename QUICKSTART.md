# Riley Quick Start Guide

## Next Steps (Sept 21-23)

### 1. Install & Configure (Today - Sept 21)

```bash
# Navigate to project
cd /c/Users/cheri/Projects/riley

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
# You'll need:
# - Vribble Supabase: URL + key (rkusqxihbkypuyjnftni)
# - Donezy Supabase: URL + key (puwxkygdlclcbyxrtppd)
# - HubSpot API key
```

### 2. Test Locally (Sept 22)

```bash
# Start development server
npm run dev

# In another terminal, test the webhook
curl -X POST http://localhost:3000/webhook/google-chat \
  -H "Content-Type: application/json" \
  -d '{
    "type": "MESSAGE",
    "message": {
      "text": "@Riley how are we doing on Acme Corp?",
      "sender": {
        "name": "user/12345",
        "displayName": "John Doe",
        "email": "john@example.com",
        "avatarUrl": ""
      },
      "space": {
        "name": "spaces/12345",
        "displayName": "Test Space",
        "type": "SPACE"
      },
      "thread": {
        "name": "spaces/12345/threads/67890"
      }
    }
  }'
```

### 3. Build & Deploy (Sept 23)

```bash
# Build TypeScript
npm run build

# Deploy to Railway
railway login
railway init
railway up

# Note the deployment URL, e.g.
# https://riley-production.up.railway.app
```

### 4. Configure Google Chat (Sept 24)

1. In your Google Chat space, click "Apps & integrations"
2. Create a new webhook with URL: `https://riley-production.up.railway.app/webhook/google-chat`
3. Test with real queries like:
   - "@Riley how are we doing on [Client]?"
   - "@Riley what's overdue?"
   - "@Riley who needs a follow-up?"

## Architecture Overview

### Query Handling Flow
```
Google Chat Message
    ↓
Webhook Handler (server.ts)
    ↓
Parser (riley/parser.ts)
    ↓
Fetches Data:
  • Vribble → Meetings
  • Donezy → Tasks
  • HubSpot → Contacts/Deals
    ↓
Responder (riley/responder.ts)
    ↓
Send to Google Chat
```

### Supported Queries

| Query | Pattern | Data Sources | Response |
|-------|---------|--------------|----------|
| Client Status | "how are we doing on [Client]?" | Vribble, Donezy, HubSpot | Last contacted, recent meetings, tasks, deals |
| Overdue | "what's overdue?" | Donezy | Tasks > 7 days stale, ranked by priority |
| Project Status | "status on [Project]?" | Donezy | Progress %, tasks by status, blockers |
| Follow-ups | "who needs a follow-up?" | HubSpot | Contacts inactive > 7 days, associated deals |

## Testing Checklist

- [ ] Dependencies install without errors: `npm install`
- [ ] TypeScript compiles: `npm run build`
- [ ] Dev server starts: `npm run dev`
- [ ] Health endpoint responds: `curl http://localhost:3000/health`
- [ ] Config endpoint shows integrations: `curl http://localhost:3000/config`
- [ ] Webhook accepts Google Chat payloads
- [ ] Parser correctly identifies query types
- [ ] Responder formats responses properly
- [ ] Integrations fetch data successfully
- [ ] Deploy to Railway succeeds
- [ ] Real Google Chat webhook works

## Debugging

### Check Logs
```bash
# Local development
npm run dev
# Check console for request/response logs

# Railway deployment
railway logs
```

### Test Individual Integrations
Edit `src/server.ts` temporarily to test:
```typescript
// Add to webhook handler to debug
logger.info('Query parsed:', { query });
logger.info('Response data:', { responseData });
logger.info('Final response:', { responseText });
```

### Common Issues

| Issue | Solution |
|-------|----------|
| "Missing Vribble credentials" | Check `.env` has `VRIBBLE_SUPABASE_URL` and `VRIBBLE_SUPABASE_KEY` |
| "Invalid HubSpot key" | Verify API key in HubSpot settings, ensure it's not expired |
| Webhook not triggering | Ensure Google Chat webhook URL is correct and accessible |
| Messages not formatted | Check `responder.ts` - verify response formatting with thread support |

## Project Files Reference

- **server.ts** - Express server & webhook handler
- **parser.ts** - Parse @Riley mentions into query types
- **responder.ts** - Generate formatted responses
- **logger.ts** - Audit trail & logging
- **vribble.ts** - Query Vribble Supabase
- **donezy.ts** - Query Donezy Supabase
- **hubspot.ts** - Query HubSpot API
- **google-chat.ts** - Send messages to Google Chat
- **types.ts** - TypeScript type definitions
- **config.ts** - Configuration management

## Timeline

| Date | Milestone |
|------|-----------|
| Sept 21 | Core service complete ✓ |
| Sept 22 | Local testing complete |
| Sept 23 | Deploy to Railway |
| Sept 24-25 | Test with real data |
| Sept 25-30 | Iterate & refine |
| Oct 1 | Live launch |

## Next Development Phases

After MVP launch, planned enhancements:
1. **HubSpot Activity Logging** - Log Riley interactions back to HubSpot
2. **Scheduled Reports** - Daily/weekly summaries via cron
3. **Teams/Slack Support** - API-first design ready for expansion
4. **Custom Commands** - User-defined queries
5. **Analytics Dashboard** - Track Riley usage patterns

---

**Ready to start?** Run `npm install` in `/c/Users/cheri/Projects/riley` and begin testing!
