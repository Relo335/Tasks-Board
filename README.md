# Operations Command Center — Task Board

A single-file web app (dark-mode operations dashboard) for the team.
Live shared board is powered by Supabase (keys are embedded in index.html).

## Deploy
This is a static site. Nothing to build.

**Vercel (from this GitHub repo):**
1. Push this repo to GitHub.
2. In Vercel → Add New → Project → import this repo.
3. Framework preset: **Other**. Build command: leave empty. Output directory: leave as root ("./").
4. Deploy. Vercel gives you a URL like https://taskboard-xxxx.vercel.app — that is the team link.

**Or drag-and-drop (no Git):** drop this folder at app.netlify.com/drop or vercel.com/new.

## Verify
Open the live URL in an incognito window. The top-bar pill should read **Live**
(meaning it is connected to Supabase and everyone shares one board).

## Notes
- Each person sets their own name in Settings (greeting + "My Tasks" are per-device).
- Anyone with the link can view/edit (no login). Ask to add a password/auth if needed.
