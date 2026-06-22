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
- Email notifications to the owner (assigned / almost-overdue / overdue) with repeat prevention

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

## Email notifications (Google Apps Script)
Notifications are **emailed to the task owner (cc manager)** on assign,
almost-overdue (1 hour before due, by default), and overdue. The owner/manager
emails come from the Team Directory. Sending is done by your **Google Apps Script
web app**: the browser posts through the same-origin proxy `api/notify.js` (to
avoid CORS) and the cron (`api/cron-reminders.js`) posts to the Apps Script URL
directly. Repeat sends are prevented (tracked per task).

### Deploy the Apps Script web app
1. Open your Apps Script project (or **Extensions → Apps Script** from a Sheet).
   Paste the `doPost(e)` function shown in the comment at the bottom of `index.html`.
2. **Deploy → New deployment → Web app** → *Execute as:* **Me** → *Who has access:*
   **Anyone** → **Deploy** → copy the **Web app URL** (ends in `/exec`).
3. In the app: **Settings → Email Notifications** → paste that `/exec` URL →
   set the reminder timing (default 1 hour) → **Save** → **Send test email**.
4. Fill in each person's **Email** in **Settings → Team Directory** (required to
   receive notifications), then **Save team**.

### Vercel env vars (Project → Settings → Environment Variables)
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` (required; service role is never used)
- `APPS_SCRIPT_URL` — your Apps Script `/exec` URL (used by the cron; otherwise the
  cron reads the URL saved in the app's settings)
- `CRON_SECRET` (recommended — pass it as `?key=` when calling the cron endpoint)
- `REMINDER_TIMEZONE` (default `America/New_York` — DST-aware, so Eastern times are
  always correct; change only if the team is in another timezone)
- `REMINDER_LEAD_MIN` (minutes before due for the "almost due" reminder; default `60`)
- `APP_URL` (optional — adds an "Open Task Board" link to the email)

In-app reminders are checked every ~60s while someone has the board open; the cron
covers the rest. Assigned-task emails fire instantly from the app.

### 24/7 reminders (cron) — fire 1 hour before due
`api/cron-reminders.js` runs server-side so reminders fire even when nobody has the
board open. The `vercel.json` cron runs once per day (the max on Vercel's free Hobby
plan), kept only as a backstop. For true 1-hour-before timing you need a check every
~15 minutes:
- **Free (any plan):** create a free job at https://cron-job.org that GETs
  `https://YOUR-SITE/api/cron-reminders?key=YOUR_CRON_SECRET` every 15 minutes.
- **Vercel Pro:** change the schedule in `vercel.json` to `*/15 * * * *` (every 15 min);
  Vercel Cron sends the secret automatically.

## Notes
- Each person sets their own name (top-right profile) — greeting and "My Tasks" are per-device.
- Anyone with the link can view/edit (no login). Ask to add auth if you need it.
