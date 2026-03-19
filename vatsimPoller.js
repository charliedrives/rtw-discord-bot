function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const R_km = 6371.0;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const km = R_km * c;
  return km * 0.539957;
}

const AIRPORTS = {
  EGSS: { lat: 51.8850, lon: 0.2350, elevFt: 348 },
  EGPD: { lat: 57.2019, lon: -2.1978, elevFt: 215 },
  BIKF: { lat: 63.9850, lon: -22.6056, elevFt: 171 },
  BGSF: { lat: 67.0122, lon: -50.7116, elevFt: 165 },
  CYUL: { lat: 45.4706, lon: -73.7408, elevFt: 118 },
  KDTW: { lat: 42.2162, lon: -83.3554, elevFt: 645 },
  KDEN: { lat: 39.8561, lon: -104.6737, elevFt: 5431 },
  KLAS: { lat: 36.0840, lon: -115.1537, elevFt: 2181 },
  KLAX: { lat: 33.9425, lon: -118.4081, elevFt: 125 },
  KSEA: { lat: 47.4502, lon: -122.3088, elevFt: 433 },
  CYLW: { lat: 49.9561, lon: -119.3778, elevFt: 1421 },
  PANC: { lat: 61.1743, lon: -149.9983, elevFt: 152 },
  UHPP: { lat: 53.1679, lon: 158.4537, elevFt: 131 },
  UHSS: { lat: 46.8887, lon: 142.7173, elevFt: 59 },
  RJTT: { lat: 35.5494, lon: 139.7798, elevFt: 35 },
  RJBB: { lat: 34.4347, lon: 135.2440, elevFt: 26 },
  RKSI: { lat: 37.4602, lon: 126.4407, elevFt: 23 },
  ZSPD: { lat: 31.1443, lon: 121.8083, elevFt: 13 },
  VHHH: { lat: 22.3080, lon: 113.9185, elevFt: 28 },
  RCTP: { lat: 25.0797, lon: 121.2328, elevFt: 106 },
  RPLL: { lat: 14.5086, lon: 121.0198, elevFt: 75 },
  WBSB: { lat: 4.9442, lon: 114.9284, elevFt: 73 },
  WAMM: { lat: 1.5493, lon: 124.9265, elevFt: 264 },
  AYPY: { lat: -9.4434, lon: 147.22, elevFt: 146 },
  YBCS: { lat: -16.8858, lon: 145.7553, elevFt: 10 },
  YPDN: { lat: -12.4147, lon: 130.8775, elevFt: 103 },
  WIII: { lat: -6.1256, lon: 106.6559, elevFt: 34 },
  WSSS: { lat: 1.3644, lon: 103.9915, elevFt: 22 },
  VTBS: { lat: 13.69, lon: 100.7501, elevFt: 5 },
  VYYY: { lat: 16.9073, lon: 96.1332, elevFt: 109 },
  VGHS: { lat: 23.8433, lon: 90.3978, elevFt: 30 },
  VIJP: { lat: 26.8242, lon: 75.8122, elevFt: 1263 },
  OIIE: { lat: 35.4161, lon: 51.1522, elevFt: 3305 },
  UGTB: { lat: 41.6692, lon: 44.9547, elevFt: 1624 },
  LBSF: { lat: 42.6967, lon: 23.4114, elevFt: 1742 },
  LGAV: { lat: 37.9364, lon: 23.9445, elevFt: 308 },
  LICC: { lat: 37.4668, lon: 15.0664, elevFt: 39 },
  LIEE: { lat: 39.2515, lon: 9.0543, elevFt: 13 },
  LEPA: { lat: 39.5517, lon: 2.7388, elevFt: 27 },
  LXGB: { lat: 36.1512, lon: -5.3497, elevFt: 12 },
  GMMX: { lat: 31.6069, lon: -8.0363, elevFt: 1545 },
  LPMA: { lat: 32.6979, lon: -16.7745, elevFt: 192 },
  LPPT: { lat: 38.7742, lon: -9.1342, elevFt: 374 },
  LFPG: { lat: 49.0097, lon: 2.5479, elevFt: 392 },
  UKLL: { lat: 49.8125, lon: 23.9561, elevFt: 1071 },
  EHAM: { lat: 52.3105, lon: 4.7683, elevFt: -11 },
};

const state = new Map();

function buildInitialState(overrides = {}) {
  return {
    wasOnline: false,
    dep: null,
    arr: null,
    firstSeenMs: null,
    lastSeenMs: null,
    sawDepartureProximity: false,
    sawArrivalProximity: false,
    depAirportFound: false,
    arrAirportFound: false,
    depDistanceNm: null,
    arrDistanceNm: null,
    lastLat: null,
    lastLon: null,
    lastAlt: null,
    lastGs: null,
    finalArrivalDistanceNm: null,
    durationMinutes: null,
    looksCompleted: false,
    completedAtMs: null,
    awardedThisSession: false,
    arrElevationFt: null,
    heightAboveArrivalFt: null,
    ...overrides,
  };
}

export function getVatsimDebugStatus(cid) {
  return state.get(String(cid).trim()) || null;
}

export function resetVatsimDebugStatus(cid) {
  state.delete(String(cid).trim());
  return true;
}

export function startVatsimAutoTracking({
  db,
  getNextLeg,
  onLegCompleted,
  intervalMs = 30000,
  startRadiusNm = 25,
  endRadiusNm = 15,
  minDurationMinutes = 20,
  maxArrivalHeightAboveAirportFt = 1500,
  maxArrivalGroundspeedKt = 40,
  maxDepartureAltitudeFt = 3000,
  maxDepartureGroundspeedKt = 50,
}) {
  function getAirport(icao) {
    return AIRPORTS[(icao || "").toUpperCase()] || null;
  }

  function computeLooksCompleted(s) {
    return (
      Boolean(s.dep) &&
      Boolean(s.arr) &&
      s.sawDepartureProximity &&
      s.sawArrivalProximity &&
      Number.isFinite(s.durationMinutes) &&
      s.durationMinutes >= minDurationMinutes &&
      Number.isFinite(s.finalArrivalDistanceNm) &&
      s.finalArrivalDistanceNm <= endRadiusNm &&
      Number.isFinite(s.heightAboveArrivalFt) &&
      s.heightAboveArrivalFt <= maxArrivalHeightAboveAirportFt &&
      Number.isFinite(s.lastGs) &&
      s.lastGs <= maxArrivalGroundspeedKt
    );
  }

  async function creditIfEligible({ users, s }) {
    if (s.awardedThisSession) return;

    const dep = String(s.dep || "").toUpperCase();
    const arr = String(s.arr || "").toUpperCase();

    s.looksCompleted = computeLooksCompleted(s);
    if (!s.looksCompleted) return;

    let awarded = false;

    for (const u of users) {
      const next = getNextLeg(u.guildId, u.discordId);
      if (!next) continue;

      if (dep === next.from_icao && arr === next.to_icao) {
        const result = db.prepare(`
          INSERT OR IGNORE INTO completions
          (guild_id, discord_id, leg_index, completed_at, source, dep, arr)
          VALUES (?,?,?,datetime('now'),'vatsim',?,?)
        `).run(
          u.guildId,
          u.discordId,
          next.leg_index,
          dep,
          arr
        );

        if (result.changes > 0) {
          awarded = true;
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

    if (awarded) {
      s.awardedThisSession = true;
      s.completedAtMs = Date.now();
    }
  }

  async function poll() {
    try {
      const links = db.prepare(`
        SELECT guild_id, discord_id, vatsim_cid
        FROM user_links
      `).all();

      if (!links.length) return;

      const cidToUsers = new Map();
      for (const l of links) {
        const cid = String(l.vatsim_cid || "").trim();
        if (!cid) continue;

        if (!cidToUsers.has(cid)) cidToUsers.set(cid, []);
        cidToUsers.get(cid).push({
          guildId: l.guild_id,
          discordId: l.discord_id,
        });
      }

      const res = await fetch("https://data.vatsim.net/v3/vatsim-data.json", {
        headers: { "User-Agent": "CharlieRTWBot/1.5" },
      });

      if (!res.ok) {
        console.error(`[VATSIM] Failed to fetch data: HTTP ${res.status}`);
        return;
      }

      const data = await res.json();
      const pilots = Array.isArray(data?.pilots) ? data.pilots : [];
      const pilotsByCid = new Map();

      for (const p of pilots) {
        if (p?.cid == null) continue;
        pilotsByCid.set(String(p.cid).trim(), p);
      }

      const now = Date.now();

      for (const [cid, users] of cidToUsers.entries()) {
        const pilot = pilotsByCid.get(cid);
        const isOnline = Boolean(pilot);

        let s = state.get(cid);
        if (!s) s = buildInitialState();

        if (isOnline) {
          const fp = pilot.flight_plan || pilot.flightPlan || {};
          const dep = String(fp.departure || "").toUpperCase().trim();
          const arr = String(fp.arrival || "").toUpperCase().trim();

          const lat = Number(pilot.latitude);
          const lon = Number(pilot.longitude);
          const alt = Number(pilot.altitude);
          const gs = Number(pilot.groundspeed);

          const flightPlanChanged =
            Boolean(dep) &&
            Boolean(arr) &&
            (dep !== s.dep || arr !== s.arr);

          const shouldResetForNewLeg =
            !s.wasOnline ||
            flightPlanChanged ||
            !s.dep ||
            !s.arr;

          if (shouldResetForNewLeg) {
            s = buildInitialState({
              wasOnline: true,
              dep,
              arr,
              firstSeenMs: now,
              lastSeenMs: now,
              lastLat: Number.isFinite(lat) ? lat : null,
              lastLon: Number.isFinite(lon) ? lon : null,
              lastAlt: Number.isFinite(alt) ? alt : null,
              lastGs: Number.isFinite(gs) ? gs : null,
              durationMinutes: 0,
            });

            console.log(
              `[VATSIM] Reset tracking for CID ${cid}: ${dep || "????"} -> ${arr || "????"}`
            );
          } else {
            s.wasOnline = true;
            s.lastSeenMs = now;
            s.lastLat = Number.isFinite(lat) ? lat : s.lastLat;
            s.lastLon = Number.isFinite(lon) ? lon : s.lastLon;
            s.lastAlt = Number.isFinite(alt) ? alt : s.lastAlt;
            s.lastGs = Number.isFinite(gs) ? gs : s.lastGs;
            s.durationMinutes = s.firstSeenMs
              ? (now - s.firstSeenMs) / 60000
              : 0;
          }

          const depAirport = getAirport(dep);
          const arrAirport = getAirport(arr);

          s.depAirportFound = !!depAirport;
          s.arrAirportFound = !!arrAirport;
          s.arrElevationFt = Number.isFinite(arrAirport?.elevFt)
            ? arrAirport.elevFt
            : null;

          if (dep && !depAirport) {
            console.log(
              `[VATSIM] Missing departure airport coords for ${dep} (CID ${cid})`
            );
          }

          if (arr && !arrAirport) {
            console.log(
              `[VATSIM] Missing arrival airport coords for ${arr} (CID ${cid})`
            );
          }

          if (depAirport && Number.isFinite(lat) && Number.isFinite(lon)) {
            const depDist = haversineNm(lat, lon, depAirport.lat, depAirport.lon);
            s.depDistanceNm = depDist;

            const qualifiesByDistance = depDist <= startRadiusNm;
            const qualifiesByGroundState =
              depDist <= Math.max(startRadiusNm, 40) &&
              Number.isFinite(alt) &&
              alt <= maxDepartureAltitudeFt &&
              Number.isFinite(gs) &&
              gs <= maxDepartureGroundspeedKt;

            if (qualifiesByDistance || qualifiesByGroundState) {
              s.sawDepartureProximity = true;
            }
          } else {
            s.depDistanceNm = null;
          }

          if (arrAirport && Number.isFinite(lat) && Number.isFinite(lon)) {
            const arrDist = haversineNm(lat, lon, arrAirport.lat, arrAirport.lon);
            s.arrDistanceNm = arrDist;
            s.finalArrivalDistanceNm = arrDist;

            if (Number.isFinite(alt) && Number.isFinite(arrAirport.elevFt)) {
              s.heightAboveArrivalFt = alt - arrAirport.elevFt;
            } else {
              s.heightAboveArrivalFt = null;
            }

            if (arrDist <= endRadiusNm) {
              s.sawArrivalProximity = true;
            }
          } else {
            s.arrDistanceNm = null;
            s.heightAboveArrivalFt = null;
          }

          s.looksCompleted = computeLooksCompleted(s);

          await creditIfEligible({ users, s });

          state.set(cid, s);
          continue;
        }

        if (s.wasOnline) {
          s.wasOnline = false;
          s.completedAtMs = now;
        }

        state.delete(cid);
      }
    } catch (err) {
      console.error("VATSIM auto-tracking poll error:", err);
    }
  }

  poll();
  setInterval(poll, intervalMs);
}