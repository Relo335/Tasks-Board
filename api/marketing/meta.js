// api/marketing/meta.js — Instagram + Facebook (Meta Graph API) metrics.
import { fetchMeta } from "../../lib/marketing.js";
export default async function handler(req, res) {
  try { res.status(200).json({ accounts: await fetchMeta(process.env) }); }
  catch (e) { res.status(200).json({ accounts: [{ platform: "Instagram", connected: false, note: String(e) }] }); }
}
