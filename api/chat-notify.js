// api/chat-notify.js — Vercel serverless function (Node.js runtime)
//
// Same-origin proxy that forwards messages to a Google Chat incoming webhook.
// Browsers cannot POST to chat.googleapis.com directly (no CORS headers), so the
// app posts here and this function relays the message server-side.
//
// The task board calls this with JSON: { webhook, text }
// You can also set GOOGLE_CHAT_WEBHOOK as a Vercel env var to keep the webhook
// off the client entirely (the app's webhook field can then be left blank).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { webhook, text } = req.body || {};
    const url = process.env.GOOGLE_CHAT_WEBHOOK || webhook;
    if (!url) {
      res.status(400).json({ error: "No webhook configured" });
      return;
    }
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const body = await r.text();
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, body });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
