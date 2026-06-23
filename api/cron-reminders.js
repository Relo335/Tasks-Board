// api/cron-reminders.js — Vercel serverless function (Node.js 18+ runtime)
//
// Server-side notification scan. Runs on a schedule (Vercel Cron or any external
// cron) so emails fire even when nobody has the task board open in a browser.
//
// It reads tasks from Supabase (anon key — service role is NOT used) and emails
// via Resend (lib/email.js):
//   - Assigned        -> owner            (if not already sent)
//   - For Approval     -> manager          (if not already sent)
//   - Due soon (lead)  -> owner + cc manager
//   - Overdue          -> owner + cc manager
// Per-task notif flags are written back so nothing is emailed twice.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_ANON_KEY   (required)
//   RESEND_API_KEY, RESEND_FROM       (required to actually send; see lib/email.js)
//   CRON_SECRET            optional — if set, requests must include it
//   REMINDER_TIMEZONE     default "America/New_York" (DST-aware)
//   REMINDER_LEAD_MIN     default 120 (2 hours); falls back to the app's saved setting
//   APP_URL               optional — adds an "Open Task Board" link
//   RESEND_API_KEY, RESEND_FROM   required to actually send the email

// Treat the current "Completed/Approved" plus any legacy done statuses as done.
function isDoneStatus(s){ return ["Completed/Approved","Done","Recurring Done Today","Completed"].includes(s); }

// --- self-contained email helpers (no external imports) --------------------
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function escAttr(s){ return String(s==null?"":s).replace(/"/g,"%22"); }
function buildTaskEmail(kind, t){
  t = t || {};
  const subject = `${kind || "Task update"}: ${t.name || "Task"}`;
  const row = (k,v)=> v ? `<b>${esc(k)}:</b> ${esc(v)}<br>` : "";
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1b212a">` +
    `<h2 style="margin:0 0 10px">${esc(subject)}</h2><p style="line-height:1.6">` +
    row("Task",t.name)+row("Owner",t.owner)+row("Manager",t.manager)+row("Department",t.department)+
    row("Priority",t.priority)+row("Status",t.status)+row("Start",t.start)+row("Due",t.due)+`</p>` +
    (t.notes?`<p><b>Notes:</b> ${esc(t.notes)}</p>`:"") +
    (t.attachment?`<p><b>Attachment:</b> <a href="${escAttr(t.attachment)}">${esc(t.attachment)}</a></p>`:"") +
    (t.link?`<p><a href="${escAttr(t.link)}">Open Task Board</a></p>`:"") + `</div>`;
  return { subject, html };
}
async function sendEmail({ to, cc, subject, html }){
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "Task Board <onboarding@resend.dev>";
  if(!key) return { ok:false, status:500, error:"Missing RESEND_API_KEY env var" };
  if(!to) return { ok:false, status:400, error:"No recipient" };
  const payload = { from, to: Array.isArray(to)?to:[to], subject, html };
  if(cc) payload.cc = Array.isArray(cc)?cc:[cc];
  const r = await fetch("https://api.resend.com/emails", {
    method:"POST", headers:{ Authorization:`Bearer ${key}`, "Content-Type":"application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(()=>({}));
  return { ok:r.ok, status:r.status, data };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers["authorization"] || "";
    const key = (req.query && req.query.key) || "";
    if (auth !== `Bearer ${secret}` && key !== secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ error: "Missing SUPABASE_URL / SUPABASE_ANON_KEY env vars" });
    return;
  }
  const TZ = process.env.REMINDER_TIMEZONE || "America/New_York";

  const tzOffsetMs = (tz, date) => {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const p = {};
    for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
    const hour = p.hour === "24" ? "00" : p.hour;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second);
    return asUTC - date.getTime();
  };

  const sbHeaders = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    const rowsResp = await fetch(`${SUPABASE_URL}/rest/v1/tasks?select=*`, { headers: sbHeaders });
    if (!rowsResp.ok) throw new Error("Supabase read failed: " + rowsResp.status);
    const rows = await rowsResp.json();

    const settingsRow = rows.find((r) => r.id === "__settings__");
    const settings = (settingsRow && settingsRow.data) || {};
    const team = settings.team || [];
    const emailFor = (name, stamped) => {
      if (stamped) return stamped;
      const m = team.find((x) => x.name === name);
      return (m && m.email) || "";
    };
    const leadMin = parseInt(process.env.REMINDER_LEAD_MIN, 10) || settings.reminderLeadMin || 120;
    const leadMs = leadMin * 60000;

    const tasks = rows
      .filter((r) => r.id !== "__settings__" && r.data && typeof r.data === "object")
      .map((r) => ({ ...r.data, id: r.id }));

    const now = Date.now();
    const dueInstant = (t) => {
      if (!t.dueDate) return null;
      const ms = Date.parse(`${t.dueDate}T${t.dueTime || "23:59"}:00Z`);
      if (isNaN(ms)) return null;
      return ms - tzOffsetMs(TZ, new Date(ms));
    };
    const fmt = (dateStr, timeStr) => (!dateStr ? "—" : (timeStr ? `${dateStr} ${timeStr} ET` : dateStr));

    const emailTask = async (to, cc, kind, t) => {
      if (!to) return false;
      const fields = {
        name: t.name, owner: t.owner, manager: t.manager,
        department: t.department, priority: t.priority, status: t.status,
        start: fmt(t.startDate, t.startTime), due: fmt(t.dueDate, t.dueTime),
        notes: t.notes || "",
        attachment: (t.attachments && t.attachments[0] && t.attachments[0].url) || "",
        link: process.env.APP_URL || "",
      };
      const { subject, html } = buildTaskEmail(kind, fields);
      const r = await sendEmail({ to, cc, subject, html });
      // Stay under Resend's free-tier limit of 2 requests/second.
      await new Promise((res) => setTimeout(res, 650));
      return r.ok;
    };

    // Each flag is set the moment a send is attempted (not only on success), so a
    // Resend rate-limit / 5xx is never retried on the next run in a re-blasting loop.
    const changed = [];
    for (const t of tasks) {
      if (t.deleted || t.archived || isDoneStatus(t.status)) continue;   // completed/archived/deleted: no emails
      const n = t.notif || (t.notif = { assigned: false, almost: false, overdue: false, approval: false, lastOwner: t.owner || "" });
      if (n.approval === undefined) n.approval = false;
      const ownerEmail = emailFor(t.owner, t.ownerEmail);
      const managerEmail = emailFor(t.manager, t.managerEmail);
      let didChange = false;

      // Assigned -> owner
      if (t.owner && ownerEmail && !n.assigned) {
        n.assigned = true; n.lastOwner = t.owner; didChange = true;
        await emailTask(ownerEmail, "", "Task Assigned", t);
      }

      // For Approval -> manager
      if (t.status === "For Approval" && managerEmail && !n.approval) {
        n.approval = true; didChange = true;
        await emailTask(managerEmail, "", "Task Ready For Approval", t);
      }

      // Due reminders -> owner + cc manager
      if (t.status !== "For Approval") {
        const due = dueInstant(t);
        if (due != null) {
          const ms = due - now;
          if (ms <= 0) {
            if (!n.overdue && ownerEmail) { n.overdue = true; didChange = true; await emailTask(ownerEmail, managerEmail, "Task Overdue", t); }
          } else if (ms <= leadMs) {
            if (!n.almost && ownerEmail) { n.almost = true; didChange = true; await emailTask(ownerEmail, managerEmail, "Task Due Soon", t); }
          }
        }
      }

      if (didChange) changed.push({ id: t.id, data: t, updated_at: new Date().toISOString() });
    }

    if (changed.length) {
      const headers = Object.assign({}, sbHeaders, { Prefer: "resolution=merge-duplicates" });
      await fetch(`${SUPABASE_URL}/rest/v1/tasks?on_conflict=id`, {
        method: "POST", headers, body: JSON.stringify(changed),
      });
    }

    res.status(200).json({ ok: true, scanned: tasks.length, sent: changed.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
