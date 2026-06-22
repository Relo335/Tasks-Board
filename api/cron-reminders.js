// api/cron-reminders.js — Vercel serverless function (Node.js 18+ runtime)
//
// Server-side reminder scan. Runs on a schedule (Vercel Cron or any external
// cron) so almost-overdue and overdue Google Chat notifications fire even when
// nobody has the task board open in a browser.
//
// It reads tasks straight from Supabase (anon key — service role is NOT used),
// sends each reminder as a PRIVATE Google Chat DM to the task owner (falling
// back to a shared-space webhook if the owner has no Chat user id), and writes
// back per-task notif flags so reminders are never sent twice.
//
// Required environment variables (Vercel -> Project -> Settings -> Environment Variables):
//   SUPABASE_URL                e.g. https://qegyeuaeggaxxebixwsz.supabase.co
//   SUPABASE_ANON_KEY           the anon public key
//   GCHAT_SA_EMAIL              Chat bot service-account email (for private DMs)
//   GCHAT_SA_PRIVATE_KEY        Chat bot service-account private key (PEM)
// Optional:
//   GOOGLE_CHAT_WEBHOOK         shared-space webhook used as a fallback only
//   CRON_SECRET                 if set, requests must include it (Vercel Cron sends it
//                               automatically as "Authorization: Bearer <CRON_SECRET>";
//                               external crons can pass ?key=<CRON_SECRET>)
//   REMINDER_TIMEZONE           IANA timezone for the stored wall-clock due times.
//                               Default "America/New_York" (handles EST/EDT automatically).
//   REMINDER_LEAD_MIN           minutes before due to send the "almost due" reminder.
//                               Falls back to the app's saved setting, else 60 (1 hour).

import { sendDirectMessage, sendSpaceMessage } from "../lib/gchat.js";

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
  const TZ = process.env.REMINDER_TIMEZONE || "America/New_York";

  // Convert a stored wall-clock (date + "HH:MM" in TZ) to a UTC timestamp,
  // accounting for daylight saving automatically.
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
    // --- load all rows ------------------------------------------------------
    const rowsResp = await fetch(`${SUPABASE_URL}/rest/v1/tasks?select=*`, { headers: sbHeaders });
    if (!rowsResp.ok) throw new Error("Supabase read failed: " + rowsResp.status);
    const rows = await rowsResp.json();

    const settingsRow = rows.find((r) => r.id === "__settings__");
    const settings = (settingsRow && settingsRow.data) || {};
    const team = settings.team || [];
    const memberFor = (name) => team.find((m) => m.name === name);
    const webhook = process.env.GOOGLE_CHAT_WEBHOOK || settings.googleChatWebhook || "";
    const saEmail = process.env.GCHAT_SA_EMAIL;
    const saPrivateKey = process.env.GCHAT_SA_PRIVATE_KEY;
    const canDM = !!(saEmail && saPrivateKey);
    const leadMin = parseInt(process.env.REMINDER_LEAD_MIN, 10) || settings.reminderLeadMin || 60;
    const leadMs = leadMin * 60000;
    if (!canDM && !webhook) {
      res.status(200).json({ ok: true, sent: 0, note: "No Chat bot credentials or webhook configured" });
      return;
    }

    const tasks = rows
      .filter((r) => r.id !== "__settings__" && r.data && typeof r.data === "object")
      .map((r) => ({ ...r.data, id: r.id }));

    const now = Date.now();
    const dueInstant = (t) => {
      if (!t.dueDate) return null;
      // Treat the stored wall-clock as UTC first, then correct by the TZ offset
      // at that moment (DST-aware) to get the real instant.
      const ms = Date.parse(`${t.dueDate}T${t.dueTime || "23:59"}:00Z`);
      if (isNaN(ms)) return null;
      return ms - tzOffsetMs(TZ, new Date(ms));
    };

    const fmt = (dateStr, timeStr) => {
      if (!dateStr) return "—";
      return timeStr ? `${dateStr} ${timeStr} ET` : dateStr;
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

      // Prefer a private DM to the owner; fall back to the shared-space webhook.
      const member = memberFor(task.owner);
      const userId = member && member.chatUserId;
      if (canDM && userId) {
        try {
          await sendDirectMessage({ saEmail, saPrivateKey, userId, text });
          return true;
        } catch (e) {
          console.warn("DM failed for " + task.owner + ":", e.message);
        }
      }
      if (webhook) {
        try { return await sendSpaceMessage(webhook, text); }
        catch (e) { console.warn("Space message failed:", e.message); }
      }
      return false;
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
