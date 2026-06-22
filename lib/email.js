// lib/email.js — shared email helper for the serverless functions.
//
// Sends transactional email via Resend (https://resend.com) using a plain HTTP
// call — no npm dependency. The API key lives only in the RESEND_API_KEY env var
// and is never exposed to the browser.
//
// Env vars:
//   RESEND_API_KEY   your Resend API key (re_...)
//   RESEND_FROM      verified sender, e.g. 'Task Board <tasks@yourdomain.com>'
//                    (defaults to Resend's onboarding sender for quick testing,
//                     which can only deliver to your own account email)

export function buildTaskEmail(kind, t) {
  t = t || {};
  const subject = `${kind || "Task update"}: ${t.name || "Task"}`;
  const row = (k, v) => (v ? `<b>${k}:</b> ${escapeHtml(v)}<br>` : "");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1b212a">` +
    `<h2 style="margin:0 0 10px">${escapeHtml(subject)}</h2>` +
    `<p style="line-height:1.6">` +
      row("Task", t.name) +
      row("Owner", t.owner) +
      row("Manager", t.manager) +
      row("Department", t.department) +
      row("Priority", t.priority) +
      row("Status", t.status) +
      row("Start", t.start) +
      row("Due", t.due) +
    `</p>` +
    (t.notes ? `<p><b>Notes:</b> ${escapeHtml(t.notes)}</p>` : "") +
    (t.attachment ? `<p><b>Attachment:</b> <a href="${escapeAttr(t.attachment)}">${escapeHtml(t.attachment)}</a></p>` : "") +
    (t.link ? `<p><a href="${escapeAttr(t.link)}">Open Task Board</a></p>` : "") +
    `</div>`;
  return { subject, html };
}

export async function sendEmail({ to, cc, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "Task Board <onboarding@resend.dev>";
  if (!key) return { ok: false, status: 500, error: "Missing RESEND_API_KEY env var" };
  if (!to) return { ok: false, status: 400, error: "No recipient" };

  const body = { from, to: Array.isArray(to) ? to : [to], subject, html };
  if (cc) body.cc = Array.isArray(cc) ? cc : [cc];

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return String(s == null ? "" : s).replace(/"/g, "%22");
}
