// api/marketing/youtube.js — YouTube channel statistics + top videos.
import { fetchYouTube } from "../../lib/marketing.js";
export default async function handler(req, res) {
  try { res.status(200).json({ accounts: await fetchYouTube(process.env) }); }
  catch (e) { res.status(200).json({ accounts: [{ platform: "YouTube", connected: false, note: String(e) }] }); }
}
