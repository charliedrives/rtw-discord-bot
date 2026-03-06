import tmi from "tmi.js";
import { openDb } from "./db.js";

let client = null;
let db = null;

export function startTwitch() {

  if (process.env.TWITCH_ENABLED !== "true") {
    console.log("[twitch] disabled");
    return;
  }

  db = openDb();

  const username = process.env.TWITCH_BOT_USERNAME;
  const password = process.env.TWITCH_OAUTH;
  const channel = process.env.TWITCH_CHANNEL;

  console.log("[twitch] starting connection");

  client = new tmi.Client({
    identity: {
      username,
      password,
    },
    channels: [channel],
  });

  client.on("connected", () => {
    console.log("[twitch] chat connected");
  });

  client.on("message", async (channel, tags, message, self) => {

    if (self) return;

    const msg = message.trim().toLowerCase();

    if (msg === "!rtw") {

      const rows = db.prepare(`
        SELECT discord_id, COUNT(*) AS completed
        FROM completions
        GROUP BY discord_id
        ORDER BY completed DESC
        LIMIT 3
      `).all();

      if (!rows.length) {
        client.say(channel, "🌍 RTW has not started yet.");
        return;
      }

      const total = db.prepare(`
        SELECT COUNT(*) AS c
        FROM route_legs
      `).get().c;

      const medals = ["🥇","🥈","🥉"];

      const parts = rows.map((r,i) =>
        `${medals[i]} ${r.discord_id} ${r.completed}/${total}`
      );

      client.say(channel, `🌍 RTW Leaderboard: ${parts.join(" | ")}`);

    }

  });

  client.connect();
}

export function postToTwitch(message) {

  if (!client) return;

  client.say(process.env.TWITCH_CHANNEL, message)
    .catch(err => console.error("[twitch] send error", err));
}