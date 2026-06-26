// lib/marketing.js — server-side social metric fetchers (env-driven, all safe).
//
// Each fetcher returns an ARRAY of normalized account results so a single
// platform can return more than one account (e.g. Meta → Instagram + Facebook).
// Everything is wrapped in try/catch and NEVER throws: a missing key or an API
// error returns { connected:false, note:"…" } so the app keeps working.
//
// Normalized account shape:
//   { brand, platform, accountName, connected, source, note,
//     metrics: { followers, posts, reach, impressions, engagement, likes,
//                comments, shares, saves, videoViews, profileVisits,
//                engagementRate, growthRate, watchTime },
//     posts: [ { platform, title, date, views, likes, comments, shares, saves,
//                engagementRate, link } ] }

const num = (v) => (v == null || isNaN(+v) ? 0 : +v);

export async function fetchYouTube(env) {
  const key = env.YOUTUBE_API_KEY, ch = env.YOUTUBE_CHANNEL_ID;
  const brand = env.YOUTUBE_BRAND || "YouTube";
  if (!key || !ch) return [{ brand, platform: "YouTube", connected: false, note: "Set YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID" }];
  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${encodeURIComponent(ch)}&key=${encodeURIComponent(key)}`);
    const j = await r.json();
    const item = j.items && j.items[0];
    if (!item) return [{ brand, platform: "YouTube", connected: false, note: (j.error && j.error.message) || "Channel not found" }];
    const st = item.statistics || {};
    const metrics = { followers: num(st.subscriberCount), videoViews: num(st.viewCount), posts: num(st.videoCount) };
    let posts = [];
    try {
      const s = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(ch)}&order=viewCount&type=video&maxResults=5&key=${encodeURIComponent(key)}`);
      const sj = await s.json();
      const ids = (sj.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
      if (ids.length) {
        const v = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${ids.join(",")}&key=${encodeURIComponent(key)}`);
        const vj = await v.json();
        posts = (vj.items || []).map((it) => ({
          platform: "YouTube", brand, title: (it.snippet && it.snippet.title) || "",
          date: it.snippet && it.snippet.publishedAt, views: num(it.statistics && it.statistics.viewCount),
          likes: num(it.statistics && it.statistics.likeCount), comments: num(it.statistics && it.statistics.commentCount),
          link: `https://youtu.be/${it.id}`,
        }));
      }
    } catch (e) {}
    return [{ brand, platform: "YouTube", accountName: item.snippet && item.snippet.title, connected: true, source: "YouTube Data API", metrics, posts }];
  } catch (e) {
    return [{ brand, platform: "YouTube", connected: false, note: String(e) }];
  }
}

export async function fetchMeta(env) {
  const token = env.META_ACCESS_TOKEN;
  const ig = env.INSTAGRAM_BUSINESS_ACCOUNT_ID, page = env.META_PAGE_ID;
  const brand = env.META_BRAND || "Meta";
  const out = [];
  if (!token || (!ig && !page)) {
    return [{ brand, platform: "Instagram", connected: false, note: "Set META_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID (and/or META_PAGE_ID)" }];
  }
  const tok = encodeURIComponent(token);
  // Instagram
  if (ig) {
    try {
      const r = await fetch(`https://graph.facebook.com/v19.0/${ig}?fields=username,followers_count,media_count&access_token=${tok}`);
      const j = await r.json();
      if (j.error) out.push({ brand, platform: "Instagram", connected: false, note: j.error.message });
      else {
        const metrics = { followers: num(j.followers_count), posts: num(j.media_count) };
        let posts = [];
        try {
          const m = await fetch(`https://graph.facebook.com/v19.0/${ig}/media?fields=caption,like_count,comments_count,permalink,timestamp&limit=10&access_token=${tok}`);
          const mj = await m.json();
          posts = (mj.data || []).map((p) => ({
            platform: "Instagram", brand, title: (p.caption || "").slice(0, 90), date: p.timestamp,
            likes: num(p.like_count), comments: num(p.comments_count), link: p.permalink,
          })).sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments)).slice(0, 5);
        } catch (e) {}
        try {
          const ins = await fetch(`https://graph.facebook.com/v19.0/${ig}/insights?metric=reach,impressions,profile_views&period=day&access_token=${tok}`);
          const ij = await ins.json();
          (ij.data || []).forEach((d) => {
            const last = d.values && d.values[d.values.length - 1];
            const val = last && last.value;
            if (d.name === "reach") metrics.reach = num(val);
            if (d.name === "impressions") metrics.impressions = num(val);
            if (d.name === "profile_views") metrics.profileVisits = num(val);
          });
        } catch (e) {}
        out.push({ brand, platform: "Instagram", accountName: j.username, connected: true, source: "Meta Graph API", metrics, posts });
      }
    } catch (e) { out.push({ brand, platform: "Instagram", connected: false, note: String(e) }); }
  }
  // Facebook Page
  if (page) {
    try {
      const r = await fetch(`https://graph.facebook.com/v19.0/${page}?fields=name,fan_count,followers_count&access_token=${tok}`);
      const j = await r.json();
      if (j.error) out.push({ brand, platform: "Facebook", connected: false, note: j.error.message });
      else out.push({ brand, platform: "Facebook", accountName: j.name, connected: true, source: "Meta Graph API",
        metrics: { followers: num(j.followers_count || j.fan_count) }, posts: [] });
    } catch (e) { out.push({ brand, platform: "Facebook", connected: false, note: String(e) }); }
  }
  return out;
}

export async function fetchTikTok(env) {
  const token = env.TIKTOK_ACCESS_TOKEN;
  const brand = env.TIKTOK_BRAND || "TikTok";
  if (!token) return [{ brand, platform: "TikTok", connected: false, note: "Connect account to enable live data (set TIKTOK_ACCESS_TOKEN)" }];
  try {
    // TikTok Business/Display API requires app approval + OAuth. Best-effort call;
    // returns connected:true with whatever fields are available.
    const r = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=display_name,follower_count,likes_count,video_count", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json();
    const u = j && j.data && j.data.user;
    if (!u) return [{ brand, platform: "TikTok", connected: false, note: (j && j.error && j.error.message) || "TikTok API not authorized yet" }];
    return [{ brand, platform: "TikTok", accountName: u.display_name, connected: true, source: "TikTok API",
      metrics: { followers: num(u.follower_count), likes: num(u.likes_count), posts: num(u.video_count) }, posts: [] }];
  } catch (e) {
    return [{ brand, platform: "TikTok", connected: false, note: String(e) }];
  }
}

export async function fetchLinkedIn(env) {
  const token = env.LINKEDIN_ACCESS_TOKEN;
  const org = env.LINKEDIN_ORG_ID;
  const brand = env.LINKEDIN_BRAND || "LinkedIn";
  if (!token) return [{ brand, platform: "LinkedIn", connected: false, note: "Connect account to enable live data (set LINKEDIN_ACCESS_TOKEN)" }];
  try {
    if (!org) return [{ brand, platform: "LinkedIn", connected: false, note: "Set LINKEDIN_ORG_ID for organization follower stats" }];
    const r = await fetch(`https://api.linkedin.com/v2/networkSizes/urn:li:organization:${org}?edgeType=CompanyFollowedByMember`, {
      headers: { Authorization: `Bearer ${token}`, "X-Restli-Protocol-Version": "2.0.0" },
    });
    const j = await r.json();
    const followers = j && (j.firstDegreeSize != null ? j.firstDegreeSize : null);
    if (followers == null) return [{ brand, platform: "LinkedIn", connected: false, note: (j && j.message) || "LinkedIn API not authorized yet" }];
    return [{ brand, platform: "LinkedIn", connected: true, source: "LinkedIn API", metrics: { followers: num(followers) }, posts: [] }];
  } catch (e) {
    return [{ brand, platform: "LinkedIn", connected: false, note: String(e) }];
  }
}

export async function fetchAllMarketing(env) {
  const results = await Promise.all([
    fetchMeta(env).catch((e) => [{ platform: "Instagram", connected: false, note: String(e) }]),
    fetchYouTube(env).catch((e) => [{ platform: "YouTube", connected: false, note: String(e) }]),
    fetchTikTok(env).catch((e) => [{ platform: "TikTok", connected: false, note: String(e) }]),
    fetchLinkedIn(env).catch((e) => [{ platform: "LinkedIn", connected: false, note: String(e) }]),
  ]);
  const accounts = results.flat();
  return { generatedAt: new Date().toISOString(), anyConnected: accounts.some((a) => a.connected), accounts };
}
