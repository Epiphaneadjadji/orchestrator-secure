# AI Orchestrator v2 — Secure Setup Guide

## What changed from v1

In v1 the Anthropic API key was in the frontend code — visible to anyone
who opened browser DevTools. In v2:

- The frontend calls `/api/claude` (your own server)
- `/api/claude` is a Vercel serverless function that holds the API key
- The key NEVER touches the browser
- Rate limiting: 10 requests per minute per IP

---

## Step 1 — Add your API key to Vercel

1. Go to vercel.com → click your Orchestrator project
2. Click **Settings** → **Environment Variables**
3. Click **Add**:
   - Name:  `ANTHROPIC_API_KEY`
   - Value: your Anthropic API key (starts with `sk-ant-...`)
   - Environment: check Production, Preview, Development
4. Click **Save**

⚠️  Never put the API key in your code files. Only in Vercel environment variables.

---

## Step 2 — Update the CORS origin in api/claude.js

Open `api/claude.js` and replace this line:
```
"https://your-orchestrator.vercel.app",
```
With your actual Vercel URL, e.g.:
```
"https://ai-orchestrator-epiphane.vercel.app",
```

---

## Step 3 — Push to GitHub → Vercel redeploys

GitHub Desktop → Commit ("Add secure API proxy") → Push origin
Vercel auto-deploys in ~90 seconds.

---

## Step 4 — Test it

Open your Vercel URL → type a task → approve the refined prompt.
If you see a response, the proxy is working.

To verify the key is hidden: open browser DevTools → Network tab →
click a request to /api/claude → you will NOT see any API key in the headers.

---

## File structure

```
orchestrator-secure/
├── api/
│   └── claude.js          ← Vercel serverless function (server-side)
├── src/
│   ├── App.jsx            ← Frontend (calls /api/claude, not Anthropic)
│   ├── main.jsx
│   └── useInstallPrompt.js
├── public/
│   ├── icon-192.png       ← Add your app icon (192×192)
│   ├── icon-512.png       ← Add your app icon (512×512)
│   └── apple-touch-icon.png  ← 180×180
├── index.html
├── package.json
└── vite.config.js
```

---

## Local development

Install Vercel CLI to test the serverless function locally:
```bash
npm install -g vercel
vercel dev
```
This runs both Vite and the serverless function on localhost:3000.

---

## Rate limiting

Current limit: 10 requests per minute per IP address.
To adjust, edit `maxRequests` in `api/claude.js`.
For production with paying users, consider upgrading to Redis-based
rate limiting via Upstash (free tier available).

---

## Next steps for monetisation

1. Add Supabase Auth (email login)
2. Store usage per user in Supabase
3. Add a `credits` column — deduct 1 per request
4. Integrate CinetPay (Mobile Money) or Stripe for top-ups
5. Gate access in api/claude.js by checking the user's credit balance
