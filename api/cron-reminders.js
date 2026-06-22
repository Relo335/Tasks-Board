// api/cron-reminders.js — Vercel serverless function (Node.js 18+ runtime)
//
// Server-side reminder scan. Runs on a schedule (Vercel Cron or any external
// cron) so almost-overdue and overdue email notifications fire even when nobody
// has the task board open in a browser.
//
// It reads tasks straight from Supabase (anon key — service role is NOT used),
// emails each reminder to the task owner (cc manager) by posting to your Google
// Apps Script web app, and writes back per-task notif flags so reminders are
// never sent twice (matches the in-app logic).
//
// Required environment variables (Vercel -> Project -> Settings -> Environment Variables):
//   SUPABASE_URL                e.g. https://qegyeuaeggaxxebixwsz.supabase.co
//   SUPABASE_ANON_KEY           the anon public key
// Optional:
//   APPS_SCRIPT_URL             your Apps Script /exec URL (otherwise read from the
//                               URL saved in the app's settings)
//   CRON_SECRET                 if set, requests must include it (Vercel Cron sends it
//                               automatically as "Authorization: Bearer <CRON_SECRET>";
//                               external crons can pass ?key=<CRON_SECRET>)
//   REMINDER_TIMEZONE           IANA timezone for the stored wall-clock due times.
//                               Default "America/New_York" (handles EST/EDT automatically).
//   REMINDER_LEAD_MIN           minutes before due to send the "almost due" reminder.
//                               Falls back to the app's saved setting, else 60 (1 hour).
//   APP_URL                     adds an "Open Task Board" link to the email.

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
    const appsScriptUrl = process.env.APPS_SCRIPT_URL || settings.appsScriptUrl || "";
    const leadMin = parseInt(process.env.REMINDER_LEAD_MIN, 10) || settings.reminderLeadMin || 60;
    const leadMs = leadMin * 60000;
    if (!appsScriptUrl) {
      res.status(200).json({ ok: true, sent: 0, note: "No Apps Script URL configured" });
      return;
    }

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

    const fmt = (dateStr, timeStr) => {
      if (!dateStr) return "—";
      return timeStr ? `${dateStr} ${timeStr} ET` : dateStr;
    };

    // Email the owner (cc manager) via the Apps Script web app.
    const send = async (task, kind, event) => {
      const owner = memberFor(task.owner);
      const manager = memberFor(task.manager);
      const to = owner && owner.email;
      if (!to) { console.warn("No owner email for", task.owner); return false; }
      const payload = {
        event,
        subject: `${kind}: ${task.name}`,
        to,
        cc: (manager && manager.email) || "",
        task: {
          name: task.name, owner: task.owner, manager: task.manager,
          department: task.department, priority: task.priority, status: task.status,
          startDate: task.startDate, startTime: task.startTime,
          dueDate: task.dueDate, dueTime: task.dueTime,
          start: fmt(task.startDate, task.startTime),
          due: fmt(task.dueDate, task.dueTime),
          notes: task.notes || "",
          link: process.env.APP_URL || "",
        },
      };
      try {
        const r = await fetch(appsScriptUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          redirect: "follow",
        });
        return r.ok;
      } catch (e) {
        console.warn("Email send failed for " + task.owner + ":", e.message);
        return false;
      }
    };

    const changed = [];
    for (const t of tasks) {
      if (t.status === "Done" || t.status === "Recurring Done Today") continue;
      const due = dueInstant(t);
      if (due == null) continue;
      const n = t.notif || (t.notif = { assigned: false, almost: false, overdue: false, lastOwner: t.owner || "" });
      const ms = due - now;
      if (ms <= 0) {
        if (!n.overdue && (await send(t, "Task Overdue", "overdue"))) { n.overdue = true; changed.push(t); }
      } else if (ms <= leadMs) {
        if (!n.almost && (await send(t, "Task Almost Due", "almost_due"))) { n.almost = true; changed.push(t); }
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
