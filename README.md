# Operations Command Center — Task Board

A single-file, dark-mode operations command center for the moving, restoration,
estate sale, and marketing team. Everything lives in `index.html`. The live
shared board is powered by Supabase (anon public key only, embedded in the file);
if Supabase is unreachable the app runs in local **demo mode** via `localStorage`.

## Features
- Sidebar: Dashboard, Calendar, Tasks Board, My Tasks, Departments, Recurring Tasks, Reports, Settings
- Clickable KPI dashboard cards (Active, Overdue, Due Today, Waiting, Blocked, Completed This Week)
- Collapsible department sections, full task table, right-side task detail drawer
- Calendar with department-colored pills, owner initials, "+X more", and a day drawer
- Filter chips + dropdown filters (Department, Owner, Manager, Priority, Cadence, Status)
- Quick actions: Ask for Update, Email Owner, Text Owner, Mark Done, Move Due Date, Edit, Delete
- Recurring tasks auto-spawn the next occurrence (same start/due time) when marked done
- Stuck Tasks (no update 3+ days / past due / blocked), Task Templates, and Reports
- Google Chat notifications (assigned / almost-overdue / overdue) with repeat prevention

## Deploy (Vercel, static — nothing to build)
1. Import this repo in Vercel → Add New → Project.
2. Framework preset: **Other**. Build command: empty. Output directory: `./`.
3. Deploy → you get a URL like `https://taskboard-xxxx.vercel.app` (the team link).

`vercel.json` already enables clean URLs.

## Supabase
The app stores **one row per task** in table `tasks` (`id`, `data jsonb`,
`updated_at`). Shared settings live in a row with id `__settings__`. SQL to
create the table (if needed) is in the comment at the bottom of `index.html`.
You can also paste the Project URL + anon key in **Settings**, or set
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. The service role key is never used.

## Google Chat notifications
Browsers block direct posts to `chat.googleapis.com` (CORS), so notifications go
through a tiny serverless proxy (`api/chat-notify.js`, already in this repo).
Set the webhook URL and endpoint (`/api/chat-notify`) in **Settings → Google Chat**
and click "Send test message".

In-app reminders (almost-overdue / overdue) are only checked while someone has the
board open in a browser tab.

### 24/7 reminders (Vercel Cron)
`api/cron-reminders.js` runs server-side so reminders fire even when nobody has
the board open. It reads tasks from Supabase, sends Google Chat alerts, and writes
back per-task flags so nothing is sent twice. `vercel.json` schedules it.

Set these Vercel env vars (Project → Settings → Environment Variables):
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` (required; service role is never used)
- `GOOGLE_CHAT_WEBHOOK` (optional — otherwise it uses the webhook saved in the app)
- `CRON_SECRET` (recommended — Vercel Cron sends it automatically; external crons pass `?key=`)
- `REMINDER_TZ_OFFSET_MINUTES` (your UTC offset so wall-clock due times resolve correctly,
  e.g. EST `-300`, EDT `-240`, CST `-360`, PST `-480`; default `0`)
- `APP_URL` (optional — adds an "Open Task Board" link to messages)

**Frequency:** the default schedule is once per day (the max on Vercel's free Hobby
plan). For "1 hour before due" / "15 min before" reminders you need finer granularity:
- **Vercel Pro:** change the schedule in `vercel.json` to `*/15 * * * *` (every 15 min).
- **Free alternative:** keep Hobby and use a free external cron (e.g. cron-job.org) to
  hit `https://YOUR-SITE/api/cron-reminders?key=YOUR_CRON_SECRET` every 15 minutes.

## Notes
- Each person sets their own name (top-right profile) — greeting and "My Tasks" are per-device.
- Anyone with the link can view/edit (no login). Ask to add auth if you need it.
