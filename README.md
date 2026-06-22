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
- Quick actions: Ask for Update, Email Owner, Text Owner, Mark Done / Submit for Approval, Move Due Date, Edit, Delete
- Recurring tasks auto-spawn the next occurrence (same start/due time) when marked done
- Approval workflow: tasks flagged "Requires Approval" are submitted **For Approval** (emails the manager), and the manager marks them Done
- File / attachment link per task (Google Drive, Dropbox, or any URL), shown on the board and in the drawer
- Stuck Tasks (no update 3+ days / past due / blocked), Task Templates, and Reports
- Email notifications (assigned → owner; due-soon + overdue → owner & manager; approval → manager) with per-task repeat prevention

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

## Email notifications (Resend serverless function)
Emails are sent by the serverless function **`api/send-email.js`** (shared helper
`lib/email.js`) using **Resend**. The browser never holds an API key — it POSTs the
recipients + task fields to `/api/send-email`, which sends the message. Triggers:

| Event | Recipient | Tracking flag |
|---|---|---|
| Task assigned (new owner / owner change) | owner | `notif.assigned` |
| Due soon (2 hours before, by default) | owner + cc manager | `notif.almost` |
| Overdue | owner + cc manager | `notif.overdue` |
| Marked **For Approval** | manager | `notif.approval` |

All flags live inside each task's `data` JSON, so reminders are never sent twice.
While the board is open the app checks every ~60s; `api/cron-reminders.js` covers
the same logic on a schedule so emails fire even when nobody has the board open.

### Set up Resend
1. Create a free account at [resend.com](https://resend.com) and add an **API key**.
2. To email anyone other than yourself, **verify a sending domain** in Resend.
3. In Vercel → Project → Settings → **Environment Variables**, add:
   - `RESEND_API_KEY` = `re_…`
   - `RESEND_FROM` = `Task Board <tasks@yourdomain.com>` (a verified sender; defaults
     to Resend's `onboarding@resend.dev`, which only delivers to your own account)
4. In the app → **Settings → Team & Email Addresses**, enter each owner's and
   manager's email, **Save team**, then click **Send test email**.

> Prefer SendGrid or another provider? Swap the one `fetch` call inside
> `lib/email.js` (`https://api.resend.com/emails`) for that provider's API — the
> rest of the app is unchanged.

### Cron (so due-soon / overdue fire when the board is closed)
`api/cron-reminders.js` reads Supabase and sends via Resend. Env vars:
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `RESEND_FROM`, optional
`CRON_SECRET`, `REMINDER_TIMEZONE` (default `America/New_York`), `REMINDER_LEAD_MIN`
(default `120`), `APP_URL`. The `vercel.json` cron is a daily backstop; for true
2-hours-before timing, hit `https://YOUR-SITE/api/cron-reminders?key=CRON_SECRET`
every ~15 min (free via cron-job.org, or Vercel Pro `*/15 * * * *`).

### Managers & approval
The manager dropdown uses a fixed list: **Sammy, Lisa, Dyana, Leo, Dawn, Rob**
(seeded in the Team directory so you can set their emails). When a task has
**Requires Approval = Yes**, "Mark Done" instead submits it **For Approval** and
emails the manager; the manager then marks it Done.

## Notes
- Each person sets their own name (top-right profile) — greeting and "My Tasks" are per-device.
- Anyone with the link can view/edit (no login). Ask to add auth if you need it.
