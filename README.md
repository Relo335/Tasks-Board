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

## Email notifications (Google Apps Script time trigger)
Notifications are emailed by a **Google Apps Script** that runs on a 5-minute time
trigger: it reads tasks from Supabase, emails the **owner** when a task is assigned
and the **owner + cc manager** when a task is almost due (1 hour before, by default)
or overdue, then writes per-task flags back to Supabase so nothing is sent twice.

The app's only job is to store the data the script needs — it writes each task's
`ownerEmail` and `managerEmail` (from the Team Directory) into the task JSON. Due
times are interpreted in `America/New_York` (DST-aware).

### Set up the script
1. Copy `apps-script/email-notifications.gs` into your Apps Script project,
   replacing the old Chat code (`sendChatNotifications` / `setupChatTrigger`).
2. Set `SUPABASE_ANON_KEY` (same anon key the app uses) and optionally `APP_URL`.
3. Run `setupTrigger()` once and authorize — it removes old triggers and creates
   the every-5-minutes trigger on `sendTaskEmails`.
4. Fill in each person's **Email** in the app's **Settings → Team Directory**, then
   **Save team** (an owner with no email can't be notified).

Because this script does all the sending, leave the **Settings → Email
Notifications → Apps Script Web App URL** field **blank** so the app doesn't also
try to send. The Vercel `api/notify.js` and `api/cron-reminders.js` functions stay
dormant (no `APPS_SCRIPT_URL` / no cron job configured) and are not used in this
setup.

## Notes
- Each person sets their own name (top-right profile) — greeting and "My Tasks" are per-device.
- Anyone with the link can view/edit (no login). Ask to add auth if you need it.
