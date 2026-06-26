// api/marketing/tiktok.js — TikTok metrics (requires TikTok API approval/OAuth).
import { fetchTikTok } from "../../lib/marketing.js";
export default async function handler(req, res) {
  try { res.status(200).json({ accounts: await fetchTikTok(process.env) }); }
  catch (e) { res.status(200).json({ accounts: [{ platform: "TikTok", connected: false, note: String(e) }] }); }
}
