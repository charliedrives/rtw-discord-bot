import tmi from "tmi.js";

let client = null;

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

  console.log("[twitch] starting", {
    username,
    channel,
    hasOauth: !!password,
  });

  client = new tmi.Client({
    identity: {
      username,
      password,
    },
    channels: [channel],
  });

  client.on("connected", (addr, port) => {
    console.log(`[twitch] connected to ${addr}:${port}`);
  });

  client.on("disconnected", (reason) => {
    console.log(`[twitch] disconnected: ${reason}`);
  });

  client.on("notice", (channel, msgid, message) => {
    console.log(`[twitch] notice ${msgid}: ${message}`);
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