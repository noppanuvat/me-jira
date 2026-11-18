# Jira + Gemini proxy setup

1. Create environment variables from `.env.jira.example`:
   - `JIRA_BASE_URL` (example: `https://your-domain.atlassian.net`)
   - `JIRA_EMAIL`
   - `JIRA_API_TOKEN`
   - `GEMINI_API_KEY`
   - Optional: `PORT` (default `8787`)

2. Start the proxy:

   ```bash
   export $(cat .env | xargs) # replace with your real values
   node jira-proxy-server.js
   ```

3. Keep the HTML app using proxy base URL:
   - `http://localhost:8787`
   - The page now calls:
     - `GET /health`
     - `GET /api/jira/issues/{ISSUE_KEY}`
     - `POST /api/ai/analyze`

4. Current behavior:
   - Read-only Jira integration (load issue data from Jira Cloud)
   - AI analysis via Gemini API from proxy server (model comes from frontend `aiModels`; default `gemini-3.8-flash`)
   - No write-back to Jira yet
