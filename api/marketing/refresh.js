// api/marketing/refresh.js — returns the latest metrics from every configured
// platform as clean JSON. Never throws; unconfigured platforms come back as
// { connected:false, note:"…" }. The browser saves the snapshot to Supabase.
import { fetchAllMarketing } from "../../lib/marketing.js";

export default async function handler(req, res) {
  try {
    const data = await fetchAllMarketing(process.env);
    res.status(200).json(data);
  } catch (e) {
    res.status(200).json({ generatedAt: new Date().toISOString(), anyConnected: false, accounts: [], error: String(e) });
  }
}
