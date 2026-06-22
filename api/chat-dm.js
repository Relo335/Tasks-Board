// api/chat-dm.js — Vercel serverless function (Node.js 18+ runtime)
//
// Sends a private Google Chat direct message to one owner. The app (browser)
// posts { userId, text } here; this function signs in as the Chat bot using the
// service-account credentials and delivers the DM. The service-account key never
// leaves the server.
//
// Required env vars: GCHAT_SA_EMAIL, GCHAT_SA_PRIVATE_KEY
// Optional: NOTIFY_SECRET (server-to-server callers send it as x-notify-secret
//           or ?key=; browser calls are accepted when the request is same-origin).

import { sendDirectMessage } from "../lib/gchat.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Light abuse protection: allow same-origin browser calls, or callers with the secret.
  const secret = process.env.NOTIFY_SECRET;
  const host = req.headers["host"] || "";
  const origin = req.headers["origin"] || req.headers["referer"] || "";
  const sameOrigin = !origin || origin.includes(host);
  const provided = req.headers["x-notify-secret"] || (req.query && req.query.key) || "";
  if (secret && provided !== secret && !sameOrigin) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!secret && !sameOrigin) {
    res.status(401).json({ error: "Cross-origin requests require NOTIFY_SECRET" });
    return;
  }

  try {
    const { userId, text } = req.body || {};
    if (!userId || !text) {
      res.status(400).json({ error: "userId and text are required" });
      return;
    }
    const saEmail = process.env.GCHAT_SA_EMAIL;
    const saPrivateKey = process.env.GCHAT_SA_PRIVATE_KEY;
    if (!saEmail || !saPrivateKey) {
      res.status(500).json({ error: "Missing GCHAT_SA_EMAIL / GCHAT_SA_PRIVATE_KEY env vars" });
      return;
    }
    await sendDirectMessage({ saEmail, saPrivateKey, userId, text });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
