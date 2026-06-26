// api/marketing/linkedin.js — LinkedIn org follower stats (requires LinkedIn API).
import { fetchLinkedIn } from "../../lib/marketing.js";
export default async function handler(req, res) {
  try { res.status(200).json({ accounts: await fetchLinkedIn(process.env) }); }
  catch (e) { res.status(200).json({ accounts: [{ platform: "LinkedIn", connected: false, note: String(e) }] }); }
}
