import tmi from "tmi.js";
import { openDb } from "./db.js";

let client = null;
let db = null;
let lastRtwCommandAt = 0;

export function startTwitch() {

  if (process.env.TWITCH_ENABLED !== "true") {
    console.log("[twitch] disabled");
    return;
  }

  const username = process.env.TWITCH_BOT_USERNAME;
  const password = process.env.TWITCH_OAUTH;
  const channel = process.env.TWITCH_CHANNEL;

  if (!username || !password || !channel) {
    console.log("[twitch] missing env vars", {
      hasUsername: !!username,
      hasPassword: !!password,
      hasChannel: !!channel,
    });
    return;
  }

  db = openDb();

  console.log("[twitch] starting connection", {
    username,
    channel
  });

  client = new tmi.Client({
    identity: {
      username,
      password
    },
    channels: [channel]
  });

  client.on("connected", (addr, port) => {
    console.log(`[twitch] connected to ${addr}:${port}`);
  });

  client.on("disconnected", (reason) => {
    console.log(`[twitch] disconnected: ${reason}`);
  });

  client.on("message", async (channelName, tags, message, self) => {

    if (self) return;

    const msg = message.trim().toLowerCase();

    // RTW leaderboard command
    if (msg === "!rtw") {

      const now = Date.now();

      // 30s cooldown to prevent spam
      if (now - lastRtwCommandAt < 30000) {
        return;
      }

      lastRtwCommandAt = now;

      try {

        const rows = db.prepare(`
          SELECT
            c.discord_id,
            COUNT(*) AS completed,
            COALESCE(MAX(ul.discord_name), c.discord_id) AS display_name
          FROM completions c
          LEFT JOIN user_links ul
            ON ul.discord_id = c.discord_id
          GROUP BY c.discord_id
          ORDER BY completed DESC
          LIMIT 3
        `).all();

        if (!rows.length) {
          client.say(channelName, "🌍 RTW has not started yet.");
          return;
        }

        const total = db.prepare(`
          SELECT COUNT(*) AS c
          FROM route_legs
        `).get().c;

        const medals = ["🥇","🥈","🥉"];

        const parts = rows.map((r,i) =>
          `${medals[i]} ${r.display_name} ${r.completed}/${total}`
        );

        // Leaderboard message
        client.say(channelName, `🌍 RTW Leaderboard: ${parts.join(" | ")}`);

        // Invite message slightly delayed
        setTimeout(() => {
          client.say(
            channelName,
            "✈️ Join the 🌍Round the World Tour! Route & signup: https://discord.gg/5cHGSnfUJj"
          );
        }, 1200);

      } catch (err) {
        console.error("[twitch] !rtw command error", err);
      }
    }

  });

  client.connect()
    .then(() => console.log("[twitch] chat connected"))
    .catch(err => console.error("[twitch] connection failed", err));
}


export function postToTwitch(message) {

  if (!client) {
    console.log("[twitch] client not ready");
    return;
  }

  client.say(process.env.TWITCH_CHANNEL, message)
    .then(() => console.log("[twitch] sent:", message))
    .catch(err => console.error("[twitch] send error", err));

}