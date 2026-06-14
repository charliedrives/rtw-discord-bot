import cron from "node-cron";
import { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { openDb } from "./db.js";
import { RTW_ROUTE } from "./route.js";
import { startVatsimAutoTracking, getVatsimDebugStatus } from "./vatsimPoller.js";
import { startTwitch, postToTwitch, setDiscordClient } from "./twitch.js";
import { startOverlayServer } from "./overlay-server.js";

if (!process.env.DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN. Set it in the bot host environment before starting.");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const db = openDb();

process.on("unhandledRejection", (err) => {
  console.error("[process] unhandled rejection", err);
});

process.on("uncaughtException", (err) => {
  console.error("[process] uncaught exception", err);
  process.exit(1);
});

client.on("error", (err) => {
  console.error("[discord] client error", err);
});

client.on("warn", (message) => {
  console.warn("[discord] warning", message);
});

client.on("shardDisconnect", (event) => {
  console.warn("[discord] shard disconnected", {
    code: event?.code,
    reason: event?.reason,
  });
});

/** Ensure guild settings row exists */
function ensureGuildRow(guildId) {
  db.prepare(`
    INSERT INTO guild_settings (guild_id, announce_channel_id, daily_channel_id, daily_time)
    VALUES (?, NULL, NULL, NULL)
    ON CONFLICT(guild_id) DO NOTHING
  `).run(guildId);
}

function getGuildSettings(guildId) {
  return (
    db.prepare(`
      SELECT announce_channel_id, daily_channel_id, daily_time
      FROM guild_settings
      WHERE guild_id=?
    `).get(guildId) || { announce_channel_id: null, daily_channel_id: null, daily_time: null }
  );
}

function getNextLeg(guildId, discordId) {
  return db
    .prepare(
      `
      SELECT rl.leg_index, rl.from_icao, rl.to_icao
      FROM route_legs rl
      WHERE rl.guild_id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM completions c
          WHERE c.guild_id = rl.guild_id
            AND c.discord_id = ?
            AND c.leg_index = rl.leg_index
        )
      ORDER BY rl.leg_index ASC
      LIMIT 1
    `
    )
    .get(guildId, discordId);
}

async function announceCompletion({ guildId, discordId, legIndex, dep, arr, source }) {

  const settings = getGuildSettings(guildId);
  const channelId = settings.announce_channel_id;

  // Discord announcement
  if (channelId) {

    const ch = await client.channels.fetch(channelId).catch(() => null);

    if (ch) {

      const vibe = source === "vatsim" ? "🛰️" : "📝";

      await ch.send(
        `${vibe} ✅ <@${discordId}> just smashed **Leg ${legIndex}**: **${dep} → ${arr}**`
      );

    }
  }

  // Get Discord username
  const user = await client.users.fetch(discordId).catch(() => null);
  const username = user?.username || "Pilot";

  if (user) {
  const displayName = user.globalName || user.username;

  const existing = db.prepare(`
    SELECT vatsim_cid
    FROM user_links
    WHERE guild_id = ? AND discord_id = ?
  `).get(guildId, discordId);

  const vatsimCid = existing?.vatsim_cid || `unknown-${discordId}`;

  db.prepare(`
    INSERT OR REPLACE INTO user_links
    (guild_id, discord_id, vatsim_cid, discord_name, linked_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(guildId, discordId, vatsimCid, displayName);
}
  // Twitch message
  if (username.toLowerCase() === "charliedrives") {

    postToTwitch(
      `🔥 ${username} just smashed Leg ${legIndex} — ${dep} → ${arr}`
    );

  } else {

    postToTwitch(
      `✈️ RTW update: ${username} completed Leg ${legIndex} — ${dep} → ${arr}`
    );

  }

  // Milestone check
  const completed = db.prepare(`
    SELECT COUNT(*) AS c
    FROM completions
    WHERE guild_id=? AND discord_id=?
  `).get(guildId, discordId).c;

  if ([5, 10, 15, 20, 25, 30, 35, 40].includes(completed)) {

    postToTwitch(
      `🏆 RTW milestone: ${username} has completed ${completed} legs!`
    );

  }
}

function medal(i) {
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return "🏁";
}

async function backfillDiscordNames() {
  const rows = db.prepare(`
    SELECT DISTINCT guild_id, discord_id
    FROM completions
    ORDER BY guild_id, discord_id
  `).all();

  console.log(`[backfill] checking ${rows.length} Discord IDs`);

  for (const row of rows) {
    try {
      const user = await client.users.fetch(row.discord_id).catch(() => null);
      if (!user) {
        console.log(`[backfill] user not found for ${row.discord_id}`);
        continue;
      }

      const displayName = user.globalName || user.username;

      const existing = db.prepare(`
        SELECT vatsim_cid
        FROM user_links
        WHERE guild_id = ? AND discord_id = ?
      `).get(row.guild_id, row.discord_id);

      const vatsimCid = existing?.vatsim_cid || `unknown-${row.discord_id}`;

      db.prepare(`
        INSERT OR REPLACE INTO user_links
        (guild_id, discord_id, vatsim_cid, discord_name, linked_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(row.guild_id, row.discord_id, vatsimCid, displayName);

      console.log(`[backfill] ${row.discord_id} -> ${displayName}`);

    } catch (err) {
      console.warn(`[backfill] failed for ${row.discord_id}`, err);
    }
  }

  console.log("[backfill] complete");
}


function buildWeeklyPost(guildId) {
  const totalLegs = db
    .prepare(`SELECT COUNT(*) AS c FROM route_legs WHERE guild_id=?`)
    .get(guildId).c;

  const leaderboard = db
    .prepare(
      `
      SELECT discord_id, COUNT(*) AS completed
      FROM completions
      WHERE guild_id=?
      GROUP BY discord_id
      ORDER BY completed DESC
      LIMIT 10
    `
    )
    .all(guildId);

  const recentWeek = db
    .prepare(
      `
      SELECT COUNT(*) AS c
      FROM completions
      WHERE guild_id=?
        AND completed_at >= datetime('now','-7 days')
    `
    )
    .get(guildId).c;

  const recent = db
    .prepare(
      `
      SELECT discord_id, leg_index, dep, arr, completed_at, source
      FROM completions
      WHERE guild_id=?
      ORDER BY completed_at DESC
      LIMIT 5
    `
    )
    .all(guildId);

  const rtwStats = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total_flights,
        COUNT(DISTINCT discord_id) AS unique_pilots,
        SUM(CASE WHEN source='vatsim' THEN 1 ELSE 0 END) AS vatsim_count,
        CAST(julianday('now') - julianday(MIN(completed_at)) AS INTEGER) AS days_running
      FROM completions
      WHERE guild_id=?
    `
    )
    .get(guildId);

  const mostActiveThisWeek = db
    .prepare(
      `
      SELECT discord_id, COUNT(*) AS cnt
      FROM completions
      WHERE guild_id=?
        AND completed_at >= datetime('now','-7 days')
      GROUP BY discord_id
      ORDER BY cnt DESC
      LIMIT 1
    `
    )
    .get(guildId);

  const lines = leaderboard.length
    ? leaderboard
        .map((r, i) => `${medal(i)} <@${r.discord_id}> — **${r.completed}/${totalLegs}**`)
        .join("\n")
    : "_Nobody on the board yet… first flight gets the glory 😈_";

  const recentLines = recent.length
    ? recent
        .map(
          (r) =>
            `• <@${r.discord_id}> — **Leg ${r.leg_index}** (${r.dep}→${r.arr}) ${
              r.source === "vatsim" ? "🛰️" : "📝"
            }`
        )
        .join("\n")
    : "_No completions logged yet._";

  const weekHype =
    recentWeek > 0
      ? `🔥 **${recentWeek}** legs logged in the last 7 days. Let's go!`
      : `😴 Quiet week… someone go send it.`;

  const statsLines = [];
  if (rtwStats && rtwStats.total_flights > 0) {
    const daysRunning = rtwStats.days_running || 1;
    const avgPerDay = (rtwStats.total_flights / daysRunning).toFixed(1);
    const vatsimPct = Math.round((rtwStats.vatsim_count / rtwStats.total_flights) * 100);
    statsLines.push(`📅 **Days running:** ${daysRunning}`);
    statsLines.push(`✈️ **Total legs logged:** ${rtwStats.total_flights}`);
    statsLines.push(`👥 **Pilots participating:** ${rtwStats.unique_pilots}`);
    statsLines.push(`📈 **Avg flights/day:** ${avgPerDay}`);
    statsLines.push(`🛰️ **VATSIM auto-tracked:** ${vatsimPct}%`);
  }
  if (mostActiveThisWeek) {
    statsLines.push(`🌟 **Hottest pilot this week:** <@${mostActiveThisWeek.discord_id}> (${mostActiveThisWeek.cnt} legs)`);
  }
  const statsBlock = statsLines.length
    ? statsLines.join("\n")
    : "_No stats yet — fly something!_";

  return `🌍✈️ **CHARLIE RTW WEEKLY UPDATE** ✈️🌍
${weekHype}

📊 **RTW STATS**
${statsBlock}

🏆 **LEADERBOARD (Top 10)**
${lines}

🕒 **LATEST WINS**
${recentLines}

🚀 Use **/rtw_next** to get your next mission.`;
}

async function postWeeklyUpdates() {
  const guilds = db
    .prepare(
      `
      SELECT guild_id, daily_channel_id
      FROM guild_settings
      WHERE daily_channel_id IS NOT NULL
    `
    )
    .all();

  for (const g of guilds) {
    const ch = await client.channels.fetch(g.daily_channel_id).catch(() => null);
    if (!ch) continue;

    const total = db
      .prepare(`SELECT COUNT(*) AS c FROM route_legs WHERE guild_id=?`)
      .get(g.guild_id).c;
    if (!total) continue;

    await ch.send(buildWeeklyPost(g.guild_id)).catch(() => null);
  }
}

async function completeNextLeg({ interaction, guildId, userId }) {
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM route_legs WHERE guild_id=?`)
    .get(guildId).c;

  if (!total) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("⚠️ Route not initialised here yet. Run **/rtw_setup**.");
    } else {
      await interaction.reply({ content: "⚠️ Route not initialised here yet. Run **/rtw_setup**.", flags: 64 });
    }
    return;
  }

  const next = getNextLeg(guildId, userId);

  if (!next) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("🏁 You’ve already completed the full route!");
    } else {
      await interaction.reply({ content: "🏁 You’ve already completed the full route!", flags: 64 });
    }
    return;
  }

  db.prepare(`
    INSERT OR IGNORE INTO completions
    (guild_id, discord_id, leg_index, completed_at, source, dep, arr)
    VALUES (?,?,?,datetime('now'),'manual',?,?)
  `).run(guildId, userId, next.leg_index, next.from_icao, next.to_icao);

  const msg = `✅ Completed **Leg ${next.leg_index}**: **${next.from_icao} → ${next.to_icao}**`;

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: msg, components: [] });
  } else {
    await interaction.reply({ content: msg, flags: 64 });
  }

  await announceCompletion({
    guildId,
    discordId: userId,
    legIndex: next.leg_index,
    dep: next.from_icao,
    arr: next.to_icao,
    source: "manual",
  });
}

client.once("clientReady", async () => {
  console.log(`Bot online: ${client.user.tag}`); 

  setDiscordClient(client);
  startTwitch();

  startOverlayServer({
    port: Number(process.env.OVERLAY_PORT || 3001),
  dbPath: process.env.RTW_DB_PATH || "./data/rtw.sqlite",
});

await backfillDiscordNames(); 

  startVatsimAutoTracking({
    db,
    getNextLeg,
    onLegCompleted: async ({ guildId, discordId, legIndex, dep, arr, source }) => {
      await announceCompletion({ guildId, discordId, legIndex, dep, arr, source });
    },
    intervalMs: 120000,
  });

  cron.schedule("0 9 * * 1", postWeeklyUpdates, { timezone: "Europe/London" });
}); 



client.on("interactionCreate", async (interaction) => {

  if (interaction.isButton()) {
  if (interaction.customId === "rtw_complete_button") {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    if (!guildId) {
      await interaction.reply({ content: "Use this in a server.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });
    await completeNextLeg({ interaction, guildId, userId });
    return;
  }
}

  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (!guildId) {
    await interaction.reply({ content: "Use this command in a server.", flags: 64 });
    return;
  }

  ensureGuildRow(guildId);

  try {
    if (interaction.commandName === "rtw_setup") {
      await interaction.deferReply({ flags: 64 });

      RTW_ROUTE.forEach((leg, i) => {
        db.prepare(
          `
          INSERT OR IGNORE INTO route_legs (guild_id, leg_index, from_icao, to_icao)
          VALUES (?,?,?,?)
        `
        ).run(guildId, i + 1, leg[0], leg[1]);
      });

      await interaction.editReply("✅ RTW route loaded.");
      return;
    }

    if (interaction.commandName === "rtw_channel") {
      const ch = interaction.options.getChannel("channel", true);
      db.prepare(`UPDATE guild_settings SET announce_channel_id=? WHERE guild_id=?`).run(ch.id, guildId);
      await interaction.reply(`✅ Completion announcements will post in ${ch}.`);
      return;
    }

    if (interaction.commandName === "rtw_daily_channel") {
      const ch = interaction.options.getChannel("channel", true);
      db.prepare(
        `
        UPDATE guild_settings
        SET daily_channel_id=?, daily_time=COALESCE(daily_time,'09:00')
        WHERE guild_id=?
      `
      ).run(ch.id, guildId);

      await interaction.reply(`✅ Weekly RTW updates will post in ${ch} every **Monday at 09:00 Europe/London**.`);
      return;
    }

    if (interaction.commandName === "rtw_route") {
      await interaction.deferReply();

      const rows = db
        .prepare(
          `
          SELECT leg_index, from_icao, to_icao
          FROM route_legs
          WHERE guild_id=?
          ORDER BY leg_index
        `
        )
        .all(guildId);

      if (!rows.length) {
        await interaction.editReply("⚠️ Route not loaded yet. Run /rtw_setup.");
        return;
      }

      const lines = rows.map((r) => `${r.leg_index}. ${r.from_icao} → ${r.to_icao}`);
      await interaction.editReply(`🌍 **RTW Route (${rows.length} legs)**\n\n${lines.join("\n")}`);
      return;
    }

 if (interaction.commandName === "rtw_next") {
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM route_legs WHERE guild_id=?`)
    .get(guildId).c;

  if (!total) {
    await interaction.reply("⚠️ Route not initialised here yet. Run **/rtw_setup**.");
    return;
  }

  const done = db
    .prepare(`SELECT COUNT(*) AS c FROM completions WHERE guild_id=? AND discord_id=?`)
    .get(guildId, userId).c;

  const next = getNextLeg(guildId, userId);

  if (!next) {
    await interaction.reply("🏁 You’ve completed all legs!");
    return;
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("rtw_complete_button")
      .setLabel("Complete Leg")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✈️")
  );

  await interaction.reply({
    content:
      `✈️ **Your Next RTW Leg**\n` +
      `**Leg ${next.leg_index}:** ${next.from_icao} → ${next.to_icao}\n` +
      `**Progress:** ${done}/${total}`,
    components: [row],
    flags: 64
  });

  return;
}

    if (interaction.commandName === "rtw_status") {
      await interaction.deferReply();

      const target = interaction.options.getUser("user") || interaction.user;

      const total = db
        .prepare(`SELECT COUNT(*) AS c FROM route_legs WHERE guild_id=?`)
        .get(guildId).c;

      if (!total) {
        await interaction.editReply("⚠️ Route not initialised here yet. Run **/rtw_setup**.");
        return;
      }

      const done = db
        .prepare(`SELECT COUNT(*) AS c FROM completions WHERE guild_id=? AND discord_id=?`)
        .get(guildId, target.id).c;

      const next = getNextLeg(guildId, target.id);
      const nextStr = next ? `Leg ${next.leg_index}: ${next.from_icao} → ${next.to_icao}` : "All done 🏁";

      const last = db
        .prepare(
          `
          SELECT leg_index, dep, arr, completed_at, source
          FROM completions
          WHERE guild_id=? AND discord_id=?
          ORDER BY completed_at DESC
          LIMIT 1
        `
        )
        .get(guildId, target.id);

      const lastStr = last
        ? `Last: Leg ${last.leg_index} (${last.dep}→${last.arr}) • ${last.source} • ${last.completed_at} UTC`
        : "Last: (none yet)";

      await interaction.editReply(`📊 **${target.username}** — **${done}/${total}**\n🎯 Next: **${nextStr}**\n${lastStr}`);
      return;
    }

    if (interaction.commandName === "rtw_leaderboard") {
      await interaction.deferReply();

      const total = db
        .prepare(`SELECT COUNT(*) AS c FROM route_legs WHERE guild_id=?`)
        .get(guildId).c;

      if (!total) {
        await interaction.editReply("⚠️ Route not initialised here yet. Run **/rtw_setup**.");
        return;
      }

      const rows = db
        .prepare(
          `
          SELECT discord_id, COUNT(*) AS completed
          FROM completions
          WHERE guild_id=?
          GROUP BY discord_id
          ORDER BY completed DESC
          LIMIT 10
        `
        )
        .all(guildId);

      if (!rows.length) {
        await interaction.editReply("Nobody on the board yet… first flight gets the glory 😈");
        return;
      }

      const lines = rows.map((r, i) => `${medal(i)} <@${r.discord_id}> — **${r.completed}/${total}**`);
      await interaction.editReply(`🏆 **RTW Leaderboard**\n${lines.join("\n")}`);
      return;
    }

    if (interaction.commandName === "rtw_stats") {
      await interaction.deferReply();

      const totalLegs = db
        .prepare(`SELECT COUNT(*) AS c FROM route_legs WHERE guild_id=?`)
        .get(guildId).c;

      if (!totalLegs) {
        await interaction.editReply("⚠️ Route not initialised here yet. Run **/rtw_setup**.");
        return;
      }

      const rtwStats = db
        .prepare(
          `
          SELECT
            COUNT(*) AS total_flights,
            COUNT(DISTINCT discord_id) AS unique_pilots,
            SUM(CASE WHEN source='vatsim' THEN 1 ELSE 0 END) AS vatsim_count,
            MIN(completed_at) AS first_flight,
            CAST(julianday('now') - julianday(MIN(completed_at)) AS INTEGER) AS days_running
          FROM completions
          WHERE guild_id=?
        `
        )
        .get(guildId);

      if (!rtwStats || !rtwStats.total_flights) {
        await interaction.editReply("No flights logged yet — be the first!");
        return;
      }

      const weekFlights = db
        .prepare(
          `
          SELECT COUNT(*) AS c
          FROM completions
          WHERE guild_id=?
            AND completed_at >= datetime('now','-7 days')
        `
        )
        .get(guildId).c;

      const hotPilotWeek = db
        .prepare(
          `
          SELECT discord_id, COUNT(*) AS cnt
          FROM completions
          WHERE guild_id=?
            AND completed_at >= datetime('now','-7 days')
          GROUP BY discord_id
          ORDER BY cnt DESC
          LIMIT 1
        `
        )
        .get(guildId);

      const busiestDay = db
        .prepare(
          `
          SELECT DATE(completed_at) AS day, COUNT(*) AS cnt
          FROM completions
          WHERE guild_id=?
          GROUP BY DATE(completed_at)
          ORDER BY cnt DESC
          LIMIT 1
        `
        )
        .get(guildId);

      const leader = db
        .prepare(
          `
          SELECT discord_id, COUNT(*) AS completed
          FROM completions
          WHERE guild_id=?
          GROUP BY discord_id
          ORDER BY completed DESC
          LIMIT 1
        `
        )
        .get(guildId);

      const daysRunning = rtwStats.days_running || 1;
      const avgPerDay = (rtwStats.total_flights / daysRunning).toFixed(1);
      const vatsimPct = Math.round((rtwStats.vatsim_count / rtwStats.total_flights) * 100);
      const leaderPct = leader ? Math.round((leader.completed / totalLegs) * 100) : 0;

      const daysToFinish = leader
        ? Math.ceil((totalLegs - leader.completed) / (rtwStats.total_flights / daysRunning))
        : null;

      const lines = [
        `📅 **Days running:** ${daysRunning}`,
        `✈️ **Total legs logged:** ${rtwStats.total_flights} (across ${rtwStats.unique_pilots} pilot${rtwStats.unique_pilots === 1 ? "" : "s"})`,
        `📈 **Avg flights/day:** ${avgPerDay}`,
        `🔥 **Legs this week:** ${weekFlights}`,
        `🛰️ **VATSIM auto-tracked:** ${vatsimPct}%`,
      ];

      if (busiestDay) {
        lines.push(`📆 **Busiest day:** ${busiestDay.day} (${busiestDay.cnt} legs)`);
      }

      if (leader) {
        lines.push(`🥇 **Leader:** <@${leader.discord_id}> — ${leader.completed}/${totalLegs} legs (${leaderPct}%)`);
      }

      if (hotPilotWeek) {
        lines.push(`🌟 **Hottest pilot this week:** <@${hotPilotWeek.discord_id}> (${hotPilotWeek.cnt} legs)`);
      }

      if (daysToFinish !== null) {
        lines.push(`🏁 **Est. days to leader finishing:** ~${daysToFinish} days (at current pace)`);
      }

      await interaction.editReply(`📊 **RTW CAMPAIGN STATS**\n\n${lines.join("\n")}`);
      return;
    }

    if (interaction.commandName === "rtw_complete") {
    await interaction.deferReply({ flags: 64 });
    await completeNextLeg({ interaction, guildId, userId });
    return;
    } 

    if (interaction.commandName === "rtw_check") {
      const dep = interaction.options.getString("dep", true).toUpperCase().trim();
      const arr = interaction.options.getString("arr", true).toUpperCase().trim();

      const total = db
        .prepare(`SELECT COUNT(*) AS c FROM route_legs WHERE guild_id=?`)
        .get(guildId).c;

      if (!total) {
        await interaction.reply({ content: "⚠️ Route not initialised here yet. Run **/rtw_setup**.", flags: 64 });
        return;
      }

      const next = getNextLeg(guildId, userId);
      if (!next) {
        await interaction.reply({ content: "🏁 You’ve already completed the full route!", flags: 64 });
        return;
      }

      if (dep !== next.from_icao || arr !== next.to_icao) {
        await interaction.reply({
          content: `❌ Not your next leg.\nYour next leg is **${next.leg_index}: ${next.from_icao} → ${next.to_icao}**`,
          flags: 64,
        });
        return;
      }

      db.prepare(
        `
        INSERT OR IGNORE INTO completions (guild_id, discord_id, leg_index, completed_at, source, dep, arr)
        VALUES (?,?,?,datetime('now'),'manual',?,?)
      `
      ).run(guildId, userId, next.leg_index, dep, arr);

      await interaction.reply(`✅ Completed **Leg ${next.leg_index}**: **${dep} → ${arr}**`);
      await announceCompletion({ guildId, discordId: userId, legIndex: next.leg_index, dep, arr, source: "manual" });
      return;
    }

    // ---- VATSIM identity improvements ----
    if (interaction.commandName === "vatsim_link") {
      const cid = interaction.options.getString("cid", true).trim();

      if (!/^\d{4,8}$/.test(cid)) {
        await interaction.reply({ content: "❌ CID should be numeric (e.g. 1234567).", flags: 64 });
        return;
      }

      const displayName =
        interaction.member?.nickname ||
        interaction.user.globalName ||
        interaction.user.username;

      db.prepare(
        `
        INSERT OR REPLACE INTO user_links
        (guild_id, discord_id, vatsim_cid, discord_name, linked_at)
        VALUES (?,?,?,?,datetime('now'))
      `
      ).run(guildId, userId, cid, displayName);

      await interaction.reply({ content: `✅ Linked VATSIM CID **${cid}** to <@${userId}>`, flags: 64 });
      return;
    }

    if (interaction.commandName === "vatsim_me") {
      await interaction.deferReply({ flags: 64 });

      const row = db.prepare(
        `
        SELECT vatsim_cid, discord_name, linked_at
        FROM user_links
        WHERE guild_id=? AND discord_id=?
      `
      ).get(guildId, userId);

      if (!row) {
        await interaction.editReply("🛰️ You haven’t linked a VATSIM CID yet. Use **/vatsim_link**.");
        return;
      }

      await interaction.editReply(`🛰️ Linked CID: **${row.vatsim_cid}** ✅\nName: **${row.discord_name || "n/a"}**\nLinked at: ${row.linked_at || "n/a"} UTC`);
      return;
    }

    if (interaction.commandName === "vatsim_debug") {
  await interaction.deferReply({ flags: 64 });

  const link = db.prepare(`
    SELECT vatsim_cid
    FROM user_links
    WHERE guild_id=? AND discord_id=?
  `).get(guildId, userId);

  if (!link) {
    await interaction.editReply("🛰️ You haven’t linked a VATSIM CID yet. Use **/vatsim_link**.");
    return;
  }

  const s = getVatsimDebugStatus(link.vatsim_cid);

  if (!s) {
    await interaction.editReply(
      `🛰️ CID **${link.vatsim_cid}** is linked, but there is no poller state yet.\n` +
      `This usually means the bot hasn’t seen you on VATSIM since the last restart.`
    );
    return;
  }

  const dep = s.dep || "n/a";
  const arr = s.arr || "n/a";
  const dur = Number.isFinite(s.durationMinutes) ? s.durationMinutes.toFixed(1) : "n/a";
  const dist = Number.isFinite(s.finalArrivalDistanceNm) ? s.finalArrivalDistanceNm.toFixed(1) : "n/a";
  const alt = Number.isFinite(s.lastAlt) ? s.lastAlt : "n/a";

  await interaction.editReply(
    `🛰️ **VATSIM Debug**\n` +
    `CID: **${link.vatsim_cid}**\n` +
    `Online now: **${s.wasOnline ? "yes" : "no"}**\n` +
    `DEP: **${dep}**\n` +
    `ARR: **${arr}**\n` +
    `Saw departure proximity: **${s.sawDepartureProximity ? "yes" : "no"}**\n` +
    `Saw arrival proximity: **${s.sawArrivalProximity ? "yes" : "no"}**\n` +
    `Duration: **${dur} min**\n` +
    `Final arrival distance: **${dist} nm**\n` +
    `Final altitude: **${alt} ft**\n` +
    `Would auto-credit: **${s.looksCompleted ? "yes" : "no"}**`
  );
  return;
}

    if (interaction.commandName === "vatsim_unlink") {
      await interaction.deferReply({ flags: 64 });

      const row = db.prepare(
        `
        SELECT vatsim_cid
        FROM user_links
        WHERE guild_id=? AND discord_id=?
      `
      ).get(guildId, userId);

      if (!row) {
        await interaction.editReply("🛰️ You don’t have a VATSIM CID linked yet.");
        return;
      }

      db.prepare(
        `
        DELETE FROM user_links
        WHERE guild_id=? AND discord_id=?
      `
      ).run(guildId, userId);

      await interaction.editReply(`✅ Unlinked VATSIM CID **${row.vatsim_cid}** from your account.`);
      return;
    }

    if (interaction.commandName === "vatsim_pilots") {
      await interaction.deferReply({ flags: 64 });

      const rows = db.prepare(
        `
        SELECT discord_id, vatsim_cid, discord_name, linked_at
        FROM user_links
        WHERE guild_id=?
        ORDER BY linked_at DESC
      `
      ).all(guildId);

      if (!rows.length) {
        await interaction.editReply("No pilots have linked a VATSIM CID yet.");
        return;
      }

      const header = `🛰️ **VATSIM Pilots Linked (${rows.length})**\n`;
      const lines = rows.map(r => `• <@${r.discord_id}> (${r.discord_name || "unknown"}) — **${r.vatsim_cid}** — ${r.linked_at || "n/a"} UTC`);
      const body = lines.join("\n");

      const msg = (header + "\n" + body).slice(0, 1900);
      await interaction.editReply(msg);
      return;
    }

    if (interaction.commandName === "rtw_export_db") {
      const file = process.env.RTW_DB_PATH || "./data/rtw.sqlite";
      await interaction.reply({
        content: "📦 RTW Database Export",
        files: [file],
        flags: 64,
      });
      return;
    }

    if (interaction.commandName === "rtw_restore_db") {

  await interaction.deferReply({ flags: 64 });

  const file = interaction.options.getAttachment("file", true);

  if (!file.name.endsWith(".sqlite")) {
    await interaction.editReply("❌ Please upload a `.sqlite` database file.");
    return;
  }

  const res = await fetch(file.url);
  const buffer = Buffer.from(await res.arrayBuffer());

  const fs = await import("fs");
  const path = await import("path");

  const dbPath = process.env.RTW_DB_PATH || "./data/rtw.sqlite";
  const dbDir = path.dirname(dbPath);
  if (dbDir && dbDir !== ".") {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (fs.existsSync(dbPath)) {
    const backupPath = `${dbPath}.backup-${Date.now()}`;
    fs.copyFileSync(dbPath, backupPath);
    console.log(`[restore] backed up existing database to ${backupPath}`);
  }

  fs.writeFileSync(dbPath, buffer);

  await interaction.editReply("✅ Database restored successfully. Restart the bot service.");
  return;
}

    await interaction.reply({ content: "Unknown command.", flags: 64 });
  } catch (err) {
    console.error(err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: "Something went wrong.", components: [] }).catch(() => null);
    } else {
      await interaction.reply({ content: "Something went wrong.", flags: 64 }).catch(() => null);
    }
  }
});

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error("[discord] login failed", err);
  process.exit(1);
});
