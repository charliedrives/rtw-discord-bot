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

const RTW2_LAUNCH_DATE = new Date("2026-08-31T23:00:00Z"); // midnight BST (UTC+1) on Sept 1, 2026

const RTW2_INTRO_PARAGRAPHS = [
  `🌍✈️ **WELCOME TO RTW2: THE SOUTHERN LOOP** ✈️🌍\n\nOur next round-the-world tour kicks off **September 1st**! It's a 50-leg loop starting and finishing at LAX, taking you through the Pacific, Southern Asia, the Indian Ocean, Africa, South America and the Caribbean before you're back where you started.\n\nHere's what's in store along the way:\n\nStarting at LAX, your ETOPS flying is immediately put to the test as we begin our tour of the islands. After landing in Hawaii, we set course for Auckland, routing via the Marshall Islands and Vanuatu. The demanding approach into Queenstown awaits before we turn towards Sydney and then on to spectacular Hamilton Island in Queensland. Our final Australian stop is Alice Springs, from where we head north into the Southern Asia leg, visiting Timor-Leste, Indonesia and the picturesque coastal airport of Phuket, Thailand.`,
  `Paradise continues with a flight to the Maldives via Colombo, Sri Lanka, before turning south towards the British territory of Diego Garcia. Here, we will likely find ourselves parked alongside an impressive array of US military hardware. And if you feel the need to top up your tan, there are plenty more tropical destinations ahead, with stops in the Seychelles and Mauritius before we reach Madagascar.`,
  `The African leg begins here. Kenya, Rwanda, Tanzania, Zambia and Mozambique are all on the itinerary, followed by multiple stops across South Africa. Two further legs through Namibia and Angola round off this part of the journey before we head westerly across the Atlantic.`,
  `Ascension Island, a volcanic outpost eight degrees south of the equator, may not sound like much — but it is home to Wideawake Airfield, where the RAF staged operations for the retaking of the Falklands in 1982 and from which Operation Black Buck was launched. You will land on that same historic runway before setting course for Brazil.`,
  `Our South American adventure begins in Fortaleza, followed by the spectacular descent across Guanabara Bay into Rio de Janeiro. From there, we head towards Argentina via Paraguay, taking on the demanding approach into Jorge Newbery Airport. Our history lesson continues with a landing at Mount Pleasant in the Falkland Islands, before returning to Argentina and Ushuaia in Tierra del Fuego — the world's southernmost international airport.`,
  `Arturo Merino Benítez International Airport in Chile is next, as we turn north towards the most challenging section of the tour. La Paz awaits at an elevation of 13,325 feet, making it the highest international airport in the world. A couple of legs later comes perhaps the ultimate test of flying skill: the tabletop runway of Antonio Nariño Airport in Colombia, known to many pilots as "the aircraft carrier." South America still has one more challenge in store a few legs later, with another demanding approach into Óscar Machado Zuloaga International Airport outside Caracas, Venezuela.`,
  `And then, back into paradise. Our Caribbean leg takes us through St Vincent and the Grenadines before the legendary Princess Juliana International Airport on Sint Maarten. From there, we make our way towards Mexico City via Jamaica and Honduras, before partying hard in Los Cabos. Finally, we turn north once more for San Diego before embarking on the Champagne Leg of the tour, the last flight that brings us back to where it all began — Los Angeles.\n\nRemember, this is not a race. It's an experience. Welcome to RTW 2: The Southern Loop.`,
];

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

function fmtDate(d) {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function compressRanges(nums) {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  return ranges.join(", ");
}

function longestStreak(dates) {
  if (!dates.length) return { length: 0, start: null, end: null };
  let best = { length: 1, start: dates[0], end: dates[0] };
  let curStart = dates[0];
  let curLen = 1;
  for (let i = 1; i < dates.length; i++) {
    const diff = Math.round(
      (new Date(dates[i] + "T00:00:00Z") - new Date(dates[i - 1] + "T00:00:00Z")) / 86400000
    );
    if (diff === 1) {
      curLen++;
    } else {
      curLen = 1;
      curStart = dates[i];
    }
    if (curLen > best.length) best = { length: curLen, start: curStart, end: dates[i] };
  }
  return best;
}

function longestGap(dates) {
  let best = { days: 0, from: null, to: null };
  for (let i = 1; i < dates.length; i++) {
    const diff = Math.round(
      (new Date(dates[i] + "T00:00:00Z") - new Date(dates[i - 1] + "T00:00:00Z")) / 86400000
    );
    if (diff > best.days) best = { days: diff, from: dates[i - 1], to: dates[i] };
  }
  return best;
}

function buildFarewellMessage(guildId, totalLegs) {
  const overall = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total_flights,
        COUNT(DISTINCT discord_id) AS unique_pilots,
        MIN(completed_at) AS first_flight,
        MAX(completed_at) AS last_flight,
        CAST(julianday(MAX(completed_at)) - julianday(MIN(completed_at)) AS INTEGER) AS days_running
      FROM completions WHERE guild_id=?
    `
    )
    .get(guildId);

  if (!overall || !overall.total_flights) return null;

  const leaderboard = db
    .prepare(
      `
      SELECT discord_id, COUNT(*) AS completed, MIN(completed_at) AS first_leg, MAX(completed_at) AS last_leg
      FROM completions WHERE guild_id=?
      GROUP BY discord_id
      ORDER BY completed DESC
    `
    )
    .all(guildId);

  const finishers = leaderboard.filter((r) => r.completed >= totalLegs);

  const busiestDayRows = db
    .prepare(
      `
      SELECT DATE(completed_at) AS day, COUNT(*) AS cnt
      FROM completions WHERE guild_id=?
      GROUP BY DATE(completed_at)
      ORDER BY cnt DESC
    `
    )
    .all(guildId);
  const busiestCnt = busiestDayRows[0]?.cnt || 0;
  const busiestDays = busiestDayRows.filter((r) => r.cnt === busiestCnt);

  const soloSprint = db
    .prepare(
      `
      SELECT discord_id, DATE(completed_at) AS day, COUNT(*) AS cnt
      FROM completions WHERE guild_id=?
      GROUP BY discord_id, DATE(completed_at)
      ORDER BY cnt DESC, day ASC
      LIMIT 1
    `
    )
    .get(guildId);

  let bestStreak = { discord_id: null, length: 0, start: null, end: null };
  let bestComeback = { discord_id: null, days: 0, from: null, to: null };
  for (const r of leaderboard) {
    const dates = db
      .prepare(
        `
        SELECT DISTINCT DATE(completed_at) AS d FROM completions
        WHERE guild_id=? AND discord_id=? ORDER BY d ASC
      `
      )
      .all(guildId, r.discord_id)
      .map((row) => row.d);

    const streak = longestStreak(dates);
    if (streak.length > bestStreak.length) bestStreak = { discord_id: r.discord_id, ...streak };

    const gap = longestGap(dates);
    if (gap.days > bestComeback.days) bestComeback = { discord_id: r.discord_id, ...gap };
  }

  const communityDates = db
    .prepare(`SELECT DISTINCT DATE(completed_at) AS d FROM completions WHERE guild_id=? ORDER BY d ASC`)
    .all(guildId)
    .map((r) => r.d);
  const communityStreak = longestStreak(communityDates);

  const vatsimChampion = db
    .prepare(
      `
      SELECT discord_id,
        SUM(CASE WHEN source='vatsim' THEN 1 ELSE 0 END) AS vatsim,
        COUNT(*) AS total
      FROM completions WHERE guild_id=?
      GROUP BY discord_id
      HAVING vatsim > 0
      ORDER BY vatsim DESC
      LIMIT 1
    `
    )
    .get(guildId);

  const legCounts = db
    .prepare(`SELECT leg_index, COUNT(*) AS cnt FROM completions WHERE guild_id=? GROUP BY leg_index`)
    .all(guildId);

  let legSection = "";
  if (legCounts.length) {
    const counts = legCounts.map((r) => r.cnt);
    const maxCnt = Math.max(...counts);
    const minCnt = Math.min(...counts);
    if (maxCnt !== minCnt) {
      const mostRange = compressRanges(legCounts.filter((r) => r.cnt === maxCnt).map((r) => r.leg_index));
      const leastRange = compressRanges(legCounts.filter((r) => r.cnt === minCnt).map((r) => r.leg_index));
      legSection =
        `🗺️ **WHERE EVERYONE FLEW (AND DIDN'T)**\n` +
        `Legs ${mostRange} were flown **${maxCnt} times each** — the most-repeated stretch. ` +
        `Legs ${leastRange} were completed only **${minCnt} time${minCnt === 1 ? "" : "s"} each** — the road less flown.`;
    }
  }

  const daysRunning = overall.days_running || 0;
  const lines = [];

  lines.push(`🌍✈️ **RTW1 — FINAL TRANSMISSION** ✈️🌍`);
  lines.push("");
  lines.push(
    `After **${daysRunning} days** and **${overall.total_flights} legs** logged across the ${totalLegs}-leg route, RTW1 signs off. Thanks to all **${overall.unique_pilots} pilot${overall.unique_pilots === 1 ? "" : "s"}** who flew it — RTW2 is inbound. Here's the closing report.`
  );

  if (finishers.length) {
    const fastest = [...finishers].sort(
      (a, b) =>
        new Date(a.last_leg) - new Date(a.first_leg) - (new Date(b.last_leg) - new Date(b.first_leg))
    )[0];
    const finishDays = Math.round((new Date(fastest.last_leg) - new Date(fastest.first_leg)) / 86400000);
    lines.push("");
    lines.push(`🏆 **THE ROUTE WAS COMPLETED**`);
    if (finishers.length === 1) {
      lines.push(
        `<@${fastest.discord_id}> flew all **${totalLegs}/${totalLegs}** legs — the only pilot to circumnavigate the globe on RTW1, finishing in just **${finishDays} days**.`
      );
    } else {
      const names = finishers.map((f) => `<@${f.discord_id}>`).join(", ");
      lines.push(
        `${finishers.length} pilots completed the full route: ${names}. Fastest circumnavigation: <@${fastest.discord_id}> in just **${finishDays} days**.`
      );
    }
  } else if (leaderboard.length) {
    const closest = leaderboard[0];
    lines.push("");
    lines.push(`🏆 **CLOSEST TO THE FINISH**`);
    lines.push(
      `Nobody completed the full route before sunset — closest was <@${closest.discord_id}> at **${closest.completed}/${totalLegs}** legs.`
    );
  }

  if (bestStreak.discord_id) {
    lines.push("");
    lines.push(`🔥 **BIGGEST STREAK**`);
    let streakLine = `<@${bestStreak.discord_id}> holds the individual record at **${bestStreak.length} consecutive day${bestStreak.length === 1 ? "" : "s"}** flying (${fmtDate(bestStreak.start)}–${fmtDate(bestStreak.end)})`;
    if (communityStreak.length > bestStreak.length) {
      streakLine += ` — but the whole squadron beat that together, logging a completion **every day for ${communityStreak.length} days straight** (${fmtDate(communityStreak.start)}–${fmtDate(communityStreak.end)}).`;
    } else {
      streakLine += ".";
    }
    lines.push(streakLine);
  }

  if (busiestDays.length) {
    lines.push("");
    lines.push(`⚡ **BUSIEST DAY**`);
    const dayList = busiestDays.map((r) => fmtDate(r.day)).join(" and ");
    lines.push(
      busiestDays.length > 1
        ? `Tied at **${busiestCnt} legs**: ${dayList}.`
        : `${dayList} — **${busiestCnt} legs** logged in a single day.`
    );
  }

  if (soloSprint) {
    lines.push("");
    lines.push(`🚀 **BEST SOLO SPRINT**`);
    lines.push(
      `<@${soloSprint.discord_id}> flew **${soloSprint.cnt} legs in one day** (${fmtDate(soloSprint.day)}) — the most by any pilot in a single sitting.`
    );
  }

  if (bestComeback.discord_id && bestComeback.days > 0) {
    lines.push("");
    lines.push(`🌙 **BEST COMEBACK**`);
    const cameBackOnFinalDay = bestComeback.to === overall.last_flight.slice(0, 10);
    const closer = cameBackOnFinalDay
      ? `to log the campaign's very last completion (${fmtDate(bestComeback.to)})`
      : `on ${fmtDate(bestComeback.to)}`;
    lines.push(`<@${bestComeback.discord_id}> vanished for **${bestComeback.days} days** — then returned ${closer}.`);
  }

  if (vatsimChampion) {
    const pct = Math.round((vatsimChampion.vatsim / vatsimChampion.total) * 100);
    lines.push("");
    lines.push(`🛰️ **VATSIM AUTO-TRACK CHAMPION**`);
    lines.push(
      `<@${vatsimChampion.discord_id}> — **${vatsimChampion.vatsim} of ${vatsimChampion.total}** legs auto-tracked via VATSIM (${pct}%).`
    );
  }

  if (legSection) {
    lines.push("");
    lines.push(legSection);
  }

  lines.push("");
  lines.push(`🏁 **FINAL LEADERBOARD**`);
  leaderboard.forEach((r, i) => {
    const finished = r.completed >= totalLegs;
    const pctSuffix = i === 0 ? ` (${Math.round((r.completed / totalLegs) * 100)}%)` : "";
    lines.push(`${medal(i)} <@${r.discord_id}> — ${r.completed}/${totalLegs}${pctSuffix}${finished ? " 🏆" : ""}`);
  });

  lines.push("");
  lines.push(`Thanks for flying with RTW1. See you on the new route. ✈️🌍`);

  return lines.join("\n");
}

const archiveAndResetSeason = db.transaction((guildId, season) => {
  db.prepare(
    `
    INSERT INTO route_legs_archive (season, guild_id, leg_index, from_icao, to_icao, archived_at)
    SELECT ?, guild_id, leg_index, from_icao, to_icao, datetime('now')
    FROM route_legs WHERE guild_id=?
  `
  ).run(season, guildId);

  db.prepare(
    `
    INSERT INTO completions_archive (season, guild_id, discord_id, leg_index, completed_at, source, dep, arr, archived_at)
    SELECT ?, guild_id, discord_id, leg_index, completed_at, source, dep, arr, datetime('now')
    FROM completions WHERE guild_id=?
  `
  ).run(season, guildId);

  db.prepare(`DELETE FROM completions WHERE guild_id=?`).run(guildId);
  db.prepare(`DELETE FROM route_legs WHERE guild_id=?`).run(guildId);
});

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

      if (Date.now() < RTW2_LAUNCH_DATE.getTime()) {
        const launchStr = RTW2_LAUNCH_DATE.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "Europe/London",
        });
        await interaction.editReply(`⚠️ RTW2 doesn't launch until **${launchStr}**. Hang tight!`);
        return;
      }

      const alreadyLoaded = db.prepare(`SELECT COUNT(*) AS c FROM route_legs WHERE guild_id=?`).get(guildId).c > 0;

      RTW_ROUTE.forEach((leg, i) => {
        db.prepare(
          `
          INSERT OR IGNORE INTO route_legs (guild_id, leg_index, from_icao, to_icao)
          VALUES (?,?,?,?)
        `
        ).run(guildId, i + 1, leg[0], leg[1]);
      });

      await interaction.editReply("✅ RTW route loaded.");

      if (!alreadyLoaded) {
        const [firstDep, firstArr] = RTW_ROUTE[0];
        const announceMsg =
          `🌍✈️ **A NEW RTW SEASON HAS LAUNCHED** ✈️🌍\n\n` +
          `A fresh **${RTW_ROUTE.length}-leg** route is live! First leg: **${firstDep} → ${firstArr}**.\n` +
          `Use **/rtw_next** to see your next leg, then **/rtw_complete** or **/rtw_check** to log it. Good luck out there!`;

        const settings = getGuildSettings(guildId);
        const announceCh = settings.announce_channel_id
          ? await client.channels.fetch(settings.announce_channel_id).catch(() => null)
          : interaction.channel || (await client.channels.fetch(interaction.channelId).catch(() => null));
        if (announceCh) await announceCh.send(announceMsg).catch(() => null);
      }

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

      const statsMsg = `📊 **RTW CAMPAIGN STATS**\n\n${lines.join("\n")}`;
      await interaction.editReply(statsMsg);

      const settings = getGuildSettings(guildId);
      if (settings.daily_channel_id && settings.daily_channel_id !== interaction.channelId) {
        const dailyCh = await client.channels.fetch(settings.daily_channel_id).catch(() => null);
        if (dailyCh) await dailyCh.send(statsMsg).catch(() => null);
      }
      return;
    }

    if (interaction.commandName === "rtw_farewell") {
      await interaction.deferReply();

      const totalLegs = db
        .prepare(`SELECT COUNT(*) AS c FROM route_legs WHERE guild_id=?`)
        .get(guildId).c;

      if (!totalLegs) {
        await interaction.editReply("⚠️ Route not initialised here yet. Run **/rtw_setup**.");
        return;
      }

      const farewellMsg = buildFarewellMessage(guildId, totalLegs);
      if (!farewellMsg) {
        await interaction.editReply("No flights logged yet — nothing to send off.");
        return;
      }

      await interaction.editReply(farewellMsg);

      const settings = getGuildSettings(guildId);
      if (settings.announce_channel_id && settings.announce_channel_id !== interaction.channelId) {
        const announceCh = await client.channels.fetch(settings.announce_channel_id).catch(() => null);
        if (announceCh) await announceCh.send(farewellMsg).catch(() => null);
      }
      return;
    }

    if (interaction.commandName === "rtw_new_season") {
      await interaction.deferReply({ flags: 64 });

      const label = interaction.options.getString("label", true).trim();

      const legCount = db.prepare(`SELECT COUNT(*) AS c FROM route_legs WHERE guild_id=?`).get(guildId).c;
      if (!legCount) {
        await interaction.editReply("⚠️ No route loaded here yet — nothing to archive.");
        return;
      }

      try {
        archiveAndResetSeason(guildId, label);
      } catch (err) {
        if (err.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
          await interaction.editReply(`⚠️ Season label **${label}** is already archived. Use a different label.`);
          return;
        }
        throw err;
      }

      await interaction.editReply(
        `✅ Archived the current route and progress as **${label}** and cleared this server. Run **/rtw_setup** to load the new route.`
      );
      return;
    }

    if (interaction.commandName === "rtw_post_intro") {
      await interaction.deferReply({ flags: 64 });

      const photos = RTW2_INTRO_PARAGRAPHS.map((_, i) => interaction.options.getAttachment(`photo_${i + 1}`, true));

      const settings = getGuildSettings(guildId);
      const targetCh = settings.announce_channel_id
        ? await client.channels.fetch(settings.announce_channel_id).catch(() => null)
        : interaction.channel || (await client.channels.fetch(interaction.channelId).catch(() => null));

      if (!targetCh) {
        await interaction.editReply("⚠️ Couldn't resolve a channel to post in.");
        return;
      }

      let firstMessage = null;
      for (let i = 0; i < RTW2_INTRO_PARAGRAPHS.length; i++) {
        const msg = await targetCh.send({ content: RTW2_INTRO_PARAGRAPHS[i], files: [photos[i].url] });
        if (i === 0) firstMessage = msg;
      }

      if (firstMessage) await firstMessage.pin().catch(() => null);

      await interaction.editReply(`✅ Posted the RTW2 intro (${RTW2_INTRO_PARAGRAPHS.length} messages) to ${targetCh} and pinned the first one.`);
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
