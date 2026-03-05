// vatsimPoller.js
// Auto-tracks linked VATSIM CIDs and logs STRICT next-leg completions on disconnect.

export function startVatsimAutoTracking({
  db,
  getNextLeg,
  onLegCompleted, // async ({ guildId, discordId, legIndex, dep, arr, source }) => void
  intervalMs = 120000, // 2 minutes
}) {
  // Key: vatsim cid string => { wasOnline: bool, lastDep, lastArr }
  const state = new Map();

  async function poll() {
    try {
      const links = db.prepare(`
        SELECT guild_id, discord_id, vatsim_cid
        FROM user_links
      `).all();

      if (!links.length) return;

      const cidToUsers = new Map();
      for (const l of links) {
        const cid = String(l.vatsim_cid).trim();
        if (!cid) continue;
        if (!cidToUsers.has(cid)) cidToUsers.set(cid, []);
        cidToUsers.get(cid).push({ guildId: l.guild_id, discordId: l.discord_id });
      }

      const res = await fetch("https://data.vatsim.net/v3/vatsim-data.json", {
        headers: { "User-Agent": "CharlieRTWBot/1.0 (Discord RTW Tracker)" },
      });
      if (!res.ok) return;

      const data = await res.json();
      const pilots = Array.isArray(data?.pilots) ? data.pilots : [];

      const pilotsByCid = new Map();
      for (const p of pilots) {
        if (p?.cid == null) continue;
        pilotsByCid.set(String(p.cid), p);
      }

      for (const [cid, users] of cidToUsers.entries()) {
        const pilot = pilotsByCid.get(cid);
        const isOnlineNow = Boolean(pilot);

        const prev = state.get(cid) || { wasOnline: false, lastDep: null, lastArr: null };

        if (isOnlineNow) {
          const fp = pilot.flight_plan || pilot.flightPlan || null;
          const dep = (fp?.departure || fp?.dep || "").toString().trim().toUpperCase();
          const arr = (fp?.arrival || fp?.arr || "").toString().trim().toUpperCase();

          state.set(cid, {
            wasOnline: true,
            lastDep: dep || prev.lastDep,
            lastArr: arr || prev.lastArr,
          });
          continue;
        }

        // Offline now
        if (prev.wasOnline) {
          const dep = (prev.lastDep || "").toUpperCase();
          const arr = (prev.lastArr || "").toUpperCase();

          if (dep && arr) {
            for (const u of users) {
              const next = getNextLeg(u.guildId, u.discordId);
              if (!next) continue;

              // STRICT match: must equal next leg exactly
              if (dep === next.from_icao && arr === next.to_icao) {
                db.prepare(`
                  INSERT OR IGNORE INTO completions
                  (guild_id, discord_id, leg_index, completed_at, source, dep, arr)
                  VALUES (?,?,?,datetime('now'),'vatsim',?,?)
                `).run(u.guildId, u.discordId, next.leg_index, dep, arr);

                await onLegCompleted({
                  guildId: u.guildId,
                  discordId: u.discordId,
                  legIndex: next.leg_index,
                  dep,
                  arr,
                  source: "vatsim",
                });
              }
            }
          }

          state.set(cid, { ...prev, wasOnline: false });
        } else {
          if (!state.has(cid)) state.set(cid, prev);
        }
      }
    } catch (err) {
      console.error("VATSIM auto-tracking poll error:", err);
    }
  }

  poll();
  setInterval(poll, intervalMs);
}
