// api/chat-bot.js — Vercel serverless function (Node.js 18+ runtime)
//
// Inbound endpoint for the Google Chat app. Configure this URL as the app's
// HTTP endpoint in the Chat API "Configuration" screen:
//     https://YOUR-SITE/api/chat-bot
//
// Its job is to make collecting Chat user ids painless: when a teammate sends
// the bot any message (or 1:1 DM), it replies with their numeric Chat user id,
// which you then paste into Task Board -> Settings -> Team Directory.
//
// Note: this only ever reveals the caller's own id back to themselves, so it is
// safe to leave open. Google signs each request with a Bearer JWT (audience =
// your Cloud project number) if you want to add verification later.

export default async function handler(req, res) {
  // Health check / browser visit
  if (req.method !== "POST") {
    res.status(200).json({ text: "Task Board Chat bot is running." });
    return;
  }

  const event = req.body || {};
  const sender = (event.message && event.message.sender) || event.user || {};
  const senderName = sender.name || "";           // e.g. "users/102938475610293847561"
  const displayName = sender.displayName || "";
  const userId = senderName.replace(/^users\//, "") || "unknown";

  if (event.type === "ADDED_TO_SPACE") {
    res.status(200).json({
      text: "👋 I'm the Task Board bot. Message me anything and I'll reply with your Chat user id.",
    });
    return;
  }

  if (event.type === "MESSAGE") {
    res.status(200).json({
      text:
        `Your Chat user id is *${userId}*` + (displayName ? ` (${displayName})` : "") + ".\n" +
        `Paste it into Task Board → Settings → Team Directory → "Chat user id" for ${displayName || "yourself"}, then Save team.`,
    });
    return;
  }

  // Other event types (REMOVED_FROM_SPACE, CARD_CLICKED, etc.) — acknowledge.
  res.status(200).json({});
}
