// api/send-email.js — Vercel serverless function (Node.js 18+ runtime)
//
// Sends a task notification email via Resend. The browser POSTs the recipient(s)
// and task fields; this function builds the message and delivers it so the email
// API key (RESEND_API_KEY) stays server-side and never ships to the browser.
//
// Request body: { to, cc, kind, event, task }
//   to    = owner email (or manager email for approval)
//   cc    = manager email (due-soon / overdue only), optional
//   kind  = human label, e.g. "Task Assigned"
//   task  = { name, owner, manager, department, priority, status, start, due, notes, attachment, link }

import { buildTaskEmail, sendEmail } from "../lib/email.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  // Light abuse guard: only accept same-origin browser calls (or callers with NOTIFY_SECRET).
  const secret = process.env.NOTIFY_SECRET;
  const host = req.headers["host"] || "";
  const origin = req.headers["origin"] || req.headers["referer"] || "";
  const sameOrigin = !origin || origin.includes(host);
  const provided = req.headers["x-notify-secret"] || (req.query && req.query.key) || "";
  if (!sameOrigin && (!secret || provided !== secret)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { to, cc, kind, task } = req.body || {};
    if (!to) { res.status(400).json({ error: "Missing recipient (to)" }); return; }
    const { subject, html } = buildTaskEmail(kind, task || {});
    const result = await sendEmail({ to, cc, subject, html });
    res.status(result.ok ? 200 : (result.status || 502)).json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
