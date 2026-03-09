import express from "express";
import { openDb } from "./db.js";

export function startOverlayServer(options = {}) {
  const port = options.port || process.env.PORT || 3001;
  const dbPath = options.dbPath || process.env.RTW_DB_PATH || "./data/rtw.sqlite";
  const db = openDb(dbPath);
  const app = express();

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  function getDisplayName(guildId, discordId) {

    const row = db.prepare(`
      SELECT discord_name
      FROM user_links
      WHERE guild_id = ? AND discord_id = ?
      ORDER BY linked_at DESC
      LIMIT 1
    `).get(guildId, discordId);

    if (row && row.discord_name && row.discord_name.trim() !== "") {
      return row.discord_name;
    }

  return `Discord ${discordId}`;
}

  function getDefaultGuildId() {
    const row = db.prepare(`
      SELECT guild_id
      FROM guild_settings
      ORDER BY guild_id ASC
      LIMIT 1
    `).get();

    if (row?.guild_id) return row.guild_id;

    const fromRoute = db.prepare(`
      SELECT guild_id
      FROM route_legs
      ORDER BY guild_id ASC
      LIMIT 1
    `).get();

    return fromRoute?.guild_id || null;
  }

  function getLastCompletion(guildId) {
    const row = db.prepare(`
      SELECT discord_id, leg_index, dep, arr, completed_at, source
      FROM completions
      WHERE guild_id = ?
      ORDER BY datetime(completed_at) DESC, leg_index DESC
      LIMIT 1
    `).get(guildId);

    if (!row) {
      return { text: "No completion yet", meta: null };
    }

    const pilot = getDisplayName(guildId, row.discord_id);

    return {
      text: `${pilot} – ${row.dep} → ${row.arr}`,
      meta: {
        pilot,
        discordId: row.discord_id,
        legIndex: row.leg_index,
        dep: row.dep,
        arr: row.arr,
        completedAt: row.completed_at,
        source: row.source
      }
    };
  }

  function getLeaderboard(guildId, limit = 3) {
    const totalLegs = db.prepare(`
      SELECT COUNT(*) AS c
      FROM route_legs
      WHERE guild_id = ?
    `).get(guildId)?.c || 0;

    const rows = db.prepare(`
      SELECT discord_id, COUNT(*) AS completed
      FROM completions
      WHERE guild_id = ?
      GROUP BY discord_id
      ORDER BY completed DESC, discord_id ASC
      LIMIT ?
    `).all(guildId, limit);

    if (!rows.length) {
      return { first: "No leaderboard data", full: "No leaderboard data", rows: [] };
    }

    const formattedRows = rows.map((row, index) => {
      const pilot = getDisplayName(guildId, row.discord_id);
      return {
        rank: index + 1,
        pilot,
        discordId: row.discord_id,
        completed: row.completed,
        totalLegs,
        text: `${index + 1}. ${pilot} (${row.completed}/${totalLegs || "?"})`
      };
    });

    return {
      first: formattedRows[0].text,
      full: formattedRows.map(r => r.text).join(" • "),
      rows: formattedRows
    };
  }

  function getRecentCompletions(guildId, limit = 3) {
    const rows = db.prepare(`
      SELECT discord_id, leg_index, dep, arr, completed_at, source
      FROM completions
      WHERE guild_id = ?
      ORDER BY datetime(completed_at) DESC, leg_index DESC
      LIMIT ?
    `).all(guildId, limit);

    return rows.map((row) => {
      const pilot = getDisplayName(guildId, row.discord_id);
      return {
        pilot,
        discordId: row.discord_id,
        legIndex: row.leg_index,
        dep: row.dep,
        arr: row.arr,
        completedAt: row.completed_at,
        source: row.source,
        text: `${pilot} completed Leg ${row.leg_index} — ${row.dep} → ${row.arr}`
      };
    });
  }

  function buildTicker({ recentCompletions, leaderboard }) {
    const recentText = recentCompletions.length
      ? recentCompletions.map(r => r.text).join(" • ")
      : "No recent RTW completions";

    return `${recentText} • Leaderboard: ${leaderboard.full} • Type !rtw in chat for more info •`;
  }

  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  app.get("/overlay.json", (req, res) => {
    try {
      const guildId = req.query.guild_id || getDefaultGuildId();

      if (!guildId) {
        return res.status(404).json({ error: "No guild data found" });
      }

      const lastCompletion = getLastCompletion(guildId);
      const leaderboard = getLeaderboard(guildId, 3);
      const recentCompletions = getRecentCompletions(guildId, 3);

      return res.json({
        guildId,
        lastCompletion: lastCompletion.text,
        leaderboard: leaderboard.first,
        ticker: buildTicker({ recentCompletions, leaderboard }),
        lastCompletionMeta: lastCompletion.meta,
        leaderboardRows: leaderboard.rows,
        recentCompletions,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Failed to build RTW overlay payload", error);
      return res.status(500).json({ error: "Failed to build overlay payload" });
    }
  });

  app.listen(port, () => {
    console.log(`[overlay] server running on port ${port}`);
    console.log(`[overlay] using DB: ${dbPath}`);
  });

  return app;
}
