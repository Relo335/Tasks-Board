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

## Google Chat notifications — private DMs to each owner
Notifications are sent as a **private direct message to the task owner**. A Google
Chat *incoming webhook* cannot DM individuals (it only posts to one space), so the
app uses a small Google Chat **app/bot** with a service account. The bot
credentials live server-side as Vercel env vars; the browser and the cron call the
serverless functions (`api/chat-dm.js`, `api/cron-reminders.js`) which send the DM.
If an owner has no Chat user id, the message falls back to a shared-space webhook
(`api/chat-notify.js`) when one is configured.

### One-time bot setup (you + your Workspace admin)
1. **Google Cloud project** → enable the **Google Chat API**
   (console.cloud.google.com → APIs & Services → Enable APIs → "Google Chat API").
2. **Configure the Chat app**: Chat API → **Configuration** → set app name + avatar,
   enable it, set **"Receive 1:1 messages"**, set the **App URL (HTTP endpoint)** to
   `https://YOUR-SITE/api/chat-bot`, and make it **available to your whole domain**
   (or to the specific people who'll get DMs). An admin may need to approve this so
   the bot can message users proactively.
3. **Service account**: IAM & Admin → Service Accounts → create one → **Keys** → add
   a JSON key and download it. From that JSON you need `client_email` and `private_key`.
4. **Collect each person's Chat user id** (numeric) — the easy way: have each
   teammate **send the bot any 1:1 message**; it replies with their Chat user id
   (handled by `api/chat-bot.js`). Paste each id into the app's **Settings → Team
   Directory → Chat user id** column, then **Save team**. (Alternatively, read the
   `id` field from the Admin SDK Directory API `users.get`.)

### Vercel env vars (Project → Settings → Environment Variables)
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` (required; service role is never used)
- `GCHAT_SA_EMAIL` — the service account `client_email`
- `GCHAT_SA_PRIVATE_KEY` — the service account `private_key` (paste the full PEM;
  `\n` escapes are handled)
- `CRON_SECRET` (recommended — pass it as `?key=` when calling the cron endpoint)
- `REMINDER_TIMEZONE` (default `America/New_York` — DST-aware, so Eastern times are
  always correct; change only if the team is in another timezone)
- `REMINDER_LEAD_MIN` (minutes before due for the "almost due" reminder; default `60`)
- `GOOGLE_CHAT_WEBHOOK` (optional — shared-space fallback only)
- `APP_URL` (optional — adds an "Open Task Board" link to messages)

In-app reminders are checked every ~60s while someone has the board open; the cron
covers the rest. Assigned-task DMs fire instantly from the app.

### 24/7 reminders (Vercel Cron)
`api/cron-reminders.js` runs server-side so reminders fire even when nobody has
the board open. It reads tasks from Supabase, sends Google Chat alerts, and writes
back per-task flags so nothing is sent twice. `vercel.json` schedules it.

Set these Vercel env vars (Project → Settings → Environment Variables):
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` (required; service role is never used)
- `GOOGLE_CHAT_WEBHOOK` (optional — otherwise it uses the webhook saved in the app)
- `CRON_SECRET` (recommended — pass it as `?key=` when calling the endpoint)
- `REMINDER_TIMEZONE` (default `America/New_York` — DST-aware, so Eastern times are
  always correct; change only if the team is in another timezone)
- `REMINDER_LEAD_MIN` (minutes before due for the "almost due" reminder; default `60`)
- `APP_URL` (optional — adds an "Open Task Board" link to messages)

**Frequency — fire reminders exactly 1 hour before due:** the `vercel.json` cron is
once per day (the max on Vercel's free Hobby plan), kept only as a backstop. To get
true 1-hour-before timing you need a check every ~15 minutes:
- **Free (any plan):** create a free job at https://cron-job.org that GETs
  `https://YOUR-SITE/api/cron-reminders?key=YOUR_CRON_SECRET` every 15 minutes.
- **Vercel Pro:** change the schedule in `vercel.json` to `*/15 * * * *` (every 15 min)
  and remove the `?key=` requirement (Vercel Cron sends the secret automatically).

Assigned-task notifications fire instantly from the app and do **not** depend on the cron.

## Notes
- Each person sets their own name (top-right profile) — greeting and "My Tasks" are per-device.
- Anyone with the link can view/edit (no login). Ask to add auth if you need it.
