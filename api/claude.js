// api/claude.js
// Vercel serverless function — runs on the server, never in the browser.
// The Anthropic API key lives here as an environment variable.
// The frontend calls /api/claude instead of api.anthropic.com directly.

export default async function handler(req, res) {

  // ── Only allow POST ────────────────────────────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── CORS — restrict to your own domain in production ──────────────────────
  const allowedOrigins = [
    "https://your-orchestrator.vercel.app", // replace with your actual Vercel URL
    "http://localhost:5173",                 // local dev
    "http://localhost:4173",                 // local preview
  ];
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ── Rate limiting — simple IP-based (10 requests per minute per IP) ───────
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 10;

  // In-memory store (resets on cold start — good enough for MVP)
  if (!global._rateLimitStore) global._rateLimitStore = {};
  const store = global._rateLimitStore;

  if (!store[ip]) store[ip] = { count: 0, windowStart: now };

  // Reset window if expired
  if (now - store[ip].windowStart > windowMs) {
    store[ip] = { count: 0, windowStart: now };
  }

  store[ip].count++;

  if (store[ip].count > maxRequests) {
    return res.status(429).json({
      error: "Too many requests. Please wait a moment before trying again.",
    });
  }

  // ── Validate request body ──────────────────────────────────────────────────
  const { model, system, messages, stream, max_tokens } = req.body;

  if (!model || !messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  // Whitelist allowed models — prevents abuse of expensive models
  const allowedModels = [
    "claude-opus-4-5-20251101",
    "claude-sonnet-4-20250514",
    "claude-haiku-4-5-20251001",
  ];
  if (!allowedModels.includes(model)) {
    return res.status(400).json({ error: "Model not allowed" });
  }

  // Cap max_tokens to prevent runaway costs
  const safeMaxTokens = Math.min(max_tokens || 1000, 2000);

  // ── Forward to Anthropic ───────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured on server" });
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: safeMaxTokens,
        system,
        stream: stream || false,
        messages,
      }),
    });

    // ── Streaming response ─────────────────────────────────────────────────
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const reader = anthropicRes.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value));
      }
      return res.end();
    }

    // ── Non-streaming response ─────────────────────────────────────────────
    const data = await anthropicRes.json();
    return res.status(anthropicRes.status).json(data);

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Failed to reach AI service" });
  }
}
