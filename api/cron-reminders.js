// api/cron-reminders.js — Vercel serverless function (Node.js 18+ runtime)
//
// Server-side reminder scan. Runs on a schedule (Vercel Cron or any external
// cron) so almost-overdue and overdue Google Chat notifications fire even when
// nobody has the task board open in a browser.
//
// It reads tasks straight from Supabase (anon key — service role is NOT used),
// sends notifications via the Google Chat webhook, and writes back the per-task
// notif flags so reminders are never sent twice (matches the in-app logic).
//
// Required environment variables (Vercel -> Project -> Settings -> Environment Variables):
//   SUPABASE_URL                e.g. https://qegyeuaeggaxxebixwsz.supabase.co
//   SUPABASE_ANON_KEY           the anon public key
// Optional:
//   GOOGLE_CHAT_WEBHOOK         webhook URL (otherwise read from the app's saved settings)
//   CRON_SECRET                 if set, requests must include it (Vercel Cron sends it
//                               automatically as "Authorization: Bearer <CRON_SECRET>";
//                               external crons can pass ?key=<CRON_SECRET>)
//   REMINDER_TZ_OFFSET_MINUTES  your timezone offset from UTC, in minutes, so stored
//                               wall-clock due times resolve to the right instant.
//                               Examples: EST=-300, EDT=-240, CST=-360, PST=-480. Default 0.

export default async function handler(req, res) {
  // --- auth -----------------------------------------------------------------
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
  const tzOffsetMin = parseInt(process.env.REMINDER_TZ_OFFSET_MINUTES || "0", 10) || 0;

  const sbHeaders = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // --- load all rows ------------------------------------------------------
    const rowsResp = await fetch(`${SUPABASE_URL}/rest/v1/tasks?select=*`, { headers: sbHeaders });
    if (!rowsResp.ok) throw new Error("Supabase read failed: " + rowsResp.status);
    const rows = await rowsResp.json();

    const settingsRow = rows.find((r) => r.id === "__settings__");
    const settings = (settingsRow && settingsRow.data) || {};
    const webhook = process.env.GOOGLE_CHAT_WEBHOOK || settings.googleChatWebhook || "";
    const leadMs = (settings.reminderLeadMin || 60) * 60000;
    if (!webhook) {
      res.status(200).json({ ok: true, sent: 0, note: "No Google Chat webhook configured" });
      return;
    }

    const tasks = rows
      .filter((r) => r.id !== "__settings__" && r.data && typeof r.data === "object")
      .map((r) => ({ ...r.data, id: r.id }));

    const now = Date.now();
    const dueInstant = (t) => {
      if (!t.dueDate) return null;
      // Parse stored wall-clock as UTC, then shift by the configured offset.
      const ms = Date.parse(`${t.dueDate}T${t.dueTime || "23:59"}:00Z`);
      if (isNaN(ms)) return null;
      return ms - tzOffsetMin * 60000;
    };

    const fmt = (dateStr, timeStr) => {
      if (!dateStr) return "—";
      return timeStr ? `${dateStr} ${timeStr}` : dateStr;
    };

    const send = async (task, kind) => {
      const text = [
        `*${kind}*`,
        `*Task:* ${task.name}`,
        `*Owner:* ${task.owner || "—"}`,
        `*Manager:* ${task.manager || "—"}`,
        `*Department:* ${task.department || "—"}`,
        `*Priority:* ${task.priority || "—"}`,
        `*Status:* ${task.status || "—"}`,
        `*Start:* ${fmt(task.startDate, task.startTime)}`,
        `*Due:* ${fmt(task.dueDate, task.dueTime)}`,
        process.env.APP_URL ? `<${process.env.APP_URL}|Open Task Board>` : "",
      ].filter(Boolean).join("\n");
      const r = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      return r.ok;
    };

    const changed = [];
    for (const t of tasks) {
      if (t.status === "Done" || t.status === "Recurring Done Today") continue;
      const due = dueInstant(t);
      if (due == null) continue;
      const n = t.notif || (t.notif = { assigned: false, almost: false, overdue: false, lastOwner: t.owner || "" });
      const ms = due - now;
      if (ms <= 0) {
        if (!n.overdue && (await send(t, "🔴 Task Overdue"))) { n.overdue = true; changed.push(t); }
      } else if (ms <= leadMs) {
        if (!n.almost && (await send(t, "🟠 Task Almost Due"))) { n.almost = true; changed.push(t); }
      }
    }

    // --- write back changed tasks (upsert, anon key) ------------------------
    if (changed.length) {
      const payload = changed.map((t) => ({ id: t.id, data: t, updated_at: new Date().toISOString() }));
      await fetch(`${SUPABASE_URL}/rest/v1/tasks?on_conflict=id`, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(payload),
      });
    }

    res.status(200).json({ ok: true, scanned: tasks.length, sent: changed.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
