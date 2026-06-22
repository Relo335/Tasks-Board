// api/send-email.js — Vercel serverless function (Node.js 18+ runtime)
//
// Sends a task notification email via Resend. Self-contained (no imports) so it
// always bundles cleanly on Vercel. The API key stays server-side.
//
// GET  /api/send-email           -> diagnostic: shows whether env vars are set
// POST /api/send-email { to, cc, kind, task }  -> sends the email
//
// Env vars: RESEND_API_KEY (required), RESEND_FROM (recommended)

export default async function handler(req, res) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.RESEND_FROM || "Task Board <onboarding@resend.dev>";

  // --- Diagnostic: open this URL in a browser to confirm the server config ---
  if (req.method === "GET") {
    res.status(200).json({
      ok: true,
      endpoint: "send-email",
      resendKeyConfigured: !!RESEND_API_KEY,
      from: RESEND_FROM,
      note: RESEND_API_KEY
        ? "Server has RESEND_API_KEY. POST { to, kind, task } to send."
        : "RESEND_API_KEY is NOT set on this deployment. Add it in Vercel and redeploy.",
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Optional shared secret (only enforced if NOTIFY_SECRET is set).
  const secret = process.env.NOTIFY_SECRET;
  if (secret) {
    const provided = req.headers["x-notify-secret"] || (req.query && req.query.key) || "";
    if (provided !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }
  }

  try {
    const body = await readBody(req);
    const { to, cc, kind, task } = body || {};
    if (!RESEND_API_KEY) {
      res.status(500).json({ ok: false, error: "Missing RESEND_API_KEY env var on the server (add it in Vercel and redeploy)." });
      return;
    }
    if (!to) { res.status(400).json({ ok: false, error: "Missing recipient (to). Add the person's email in Settings → Team & Email Addresses." }); return; }

    const subject = `${kind || "Task update"}: ${(task && task.name) || "Task"}`;
    const html = buildHtml(subject, task || {});

    const payload = { from: RESEND_FROM, to: Array.isArray(to) ? to : [to], subject, html };
    if (cc) payload.cc = Array.isArray(cc) ? cc : [cc];

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      res.status(200).json({ ok: true, id: data.id });
    } else {
      // Surface Resend's exact reason (e.g. "domain is not verified").
      res.status(502).json({ ok: false, error: (data && data.message) || `Resend HTTP ${r.status}`, resend: data });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}

// Robust body reader: use Vercel's parsed body if present, else read the stream.
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

function buildHtml(subject, t) {
  const row = (k, v) => (v ? `<b>${esc(k)}:</b> ${esc(v)}<br>` : "");
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1b212a">` +
    `<h2 style="margin:0 0 10px">${esc(subject)}</h2>` +
    `<p style="line-height:1.6">` +
      row("Task", t.name) + row("Owner", t.owner) + row("Manager", t.manager) +
      row("Department", t.department) + row("Priority", t.priority) + row("Status", t.status) +
      row("Start", t.start) + row("Due", t.due) +
    `</p>` +
    (t.notes ? `<p><b>Notes:</b> ${esc(t.notes)}</p>` : "") +
    (t.attachment ? `<p><b>Attachment:</b> <a href="${escAttr(t.attachment)}">${esc(t.attachment)}</a></p>` : "") +
    (t.link ? `<p><a href="${escAttr(t.link)}">Open Task Board</a></p>` : "") +
    `</div>`
  );
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escAttr(s) { return String(s == null ? "" : s).replace(/"/g, "%22"); }
