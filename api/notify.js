// api/notify.js — Vercel serverless function (Node.js 18+ runtime)
//
// Same-origin proxy that forwards an email notification to your Google Apps
// Script web app. The browser can't POST to script.google.com directly (CORS),
// so the app posts { url, payload } here and this function relays it server-side.
//
// `url`     = your Apps Script Web App URL (…/exec)  — may also be set as the
//             APPS_SCRIPT_URL env var so it never ships to the browser.
// `payload` = the JSON the Apps Script doPost expects (to, cc, subject, task).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { url, payload } = req.body || {};
    const target = process.env.APPS_SCRIPT_URL || url;
    if (!target) {
      res.status(400).json({ error: "No Apps Script URL configured" });
      return;
    }
    const r = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
      redirect: "follow", // Apps Script responds via a redirect
    });
    const body = await r.text();
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, body });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
