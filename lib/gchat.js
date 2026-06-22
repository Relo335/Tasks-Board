// lib/gchat.js — shared Google Chat helpers for the serverless functions.
//
// Sends messages as a Google Chat APP (bot) using a service-account JWT.
// No external npm dependencies — JWT signing uses Node's built-in crypto.
//
// Needed env vars (set in Vercel):
//   GCHAT_SA_EMAIL        the service account email (…@…iam.gserviceaccount.com)
//   GCHAT_SA_PRIVATE_KEY  the service account private key (PEM; \n may be escaped)

import crypto from "crypto";

const b64url = (input) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let cachedToken = null;
let cachedExp = 0;

// Mint (and cache) an OAuth access token for the Chat bot scope.
export async function getAppToken(saEmail, saPrivateKey) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedExp - 60) return cachedToken;

  const key = String(saPrivateKey || "").replace(/\\n/g, "\n");
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: saEmail,
    scope: "https://www.googleapis.com/auth/chat.bot",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signature = b64url(crypto.createSign("RSA-SHA256").update(unsigned).sign(key));
  const jwt = `${unsigned}.${signature}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const j = await resp.json();
  if (!j.access_token) throw new Error("Token request failed: " + JSON.stringify(j));
  cachedToken = j.access_token;
  cachedExp = now + (j.expires_in || 3600);
  return cachedToken;
}

// Send a private direct message to a single user (by their Chat/Directory user id).
export async function sendDirectMessage({ saEmail, saPrivateKey, userId, text }) {
  const token = await getAppToken(saEmail, saPrivateKey);

  // Find the existing 1:1 DM space between the bot and the user.
  const findResp = await fetch(
    `https://chat.googleapis.com/v1/spaces:findDirectMessage?name=${encodeURIComponent("users/" + userId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const space = await findResp.json();
  if (!space || !space.name) {
    throw new Error(
      "Could not open a DM with users/" + userId +
      " (the user must have the Chat app installed/available). Response: " + JSON.stringify(space)
    );
  }

  const msgResp = await fetch(`https://chat.googleapis.com/v1/${space.name}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!msgResp.ok) {
    throw new Error("DM send failed: " + msgResp.status + " " + (await msgResp.text()));
  }
  return true;
}

// Fallback: post to a shared space via an incoming webhook URL.
export async function sendSpaceMessage(webhook, text) {
  const r = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return r.ok;
}
