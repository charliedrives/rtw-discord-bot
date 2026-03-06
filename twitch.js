import tmi from "tmi.js";
import { openDb } from "./db.js";

let client = null;
let db = null;
let discordClient = null;
let lastRtwCommandAt = 0;

export function setDiscordClient(botClient) {
  discordClient = botClient;
}

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

    if (msg === "!rtw") {
      const now = Date.now();

      if (now - lastRtwCommandAt < 30000) {
        return;
      }

      lastRtwCommandAt = now;

      try {
        const rows = db.prepare(`
          SELECT
            discord_id,
            COUNT(*) AS completed
          FROM completions
          GROUP BY discord_id
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

        const medals = ["🥇", "🥈", "🥉"];

        const parts = await Promise.all(
          rows.map(async (r, i) => {
            let displayName = r.discord_id;

            if (discordClient) {
              const user = await discordClient.users.fetch(r.discord_id).catch(() => null);
              if (user?.username) {
                displayName = user.username;
              }
            }

            return `${medals[i]} ${displayName} ${r.completed}/${total}`;
          })
        );

        client.say(channelName, `🌍 RTW Leaderboard: ${parts.join(" | ")}`);

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