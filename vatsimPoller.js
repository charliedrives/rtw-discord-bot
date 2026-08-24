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

  // RTW2 — The Southern Road
  PHNL: { lat: 21.3187, lon: -157.9220, elevFt: 13 }, // Honolulu International Airport
  PKMJ: { lat: 7.0648, lon: 171.2720, elevFt: 6 }, // Marshall Islands International Airport
  NVVV: { lat: -17.6993, lon: 168.3200, elevFt: 70 }, // Port Vila Bauerfield Airport
  NZAA: { lat: -37.0081, lon: 174.7920, elevFt: 23 }, // Auckland International Airport
  NZQN: { lat: -45.0211, lon: 168.7390, elevFt: 1171 }, // Queenstown International Airport
  YSSY: { lat: -33.9461, lon: 151.1770, elevFt: 21 }, // Sydney Kingsford Smith International Airport
  YBHM: { lat: -20.3581, lon: 148.9520, elevFt: 15 }, // Hamilton Island Airport
  WPOC: { lat: -9.1981, lon: 124.3430, elevFt: 0 }, // Oecussi Airport
  WMKK: { lat: 2.7456, lon: 101.7100, elevFt: 69 }, // Kuala Lumpur International Airport
  WITT: { lat: 5.5235, lon: 95.4204, elevFt: 65 }, // Sultan Iskandarmuda Airport
  VCBI: { lat: 7.1808, lon: 79.8841, elevFt: 30 }, // Bandaranaike International Colombo Airport
  VRMM: { lat: 4.1918, lon: 73.5291, elevFt: 6 }, // Male International Airport
  FJDG: { lat: -7.3133, lon: 72.4111, elevFt: 9 }, // Diego Garcia Naval Support Facility
  FSIA: { lat: -4.6743, lon: 55.5218, elevFt: 10 }, // Seychelles International Airport
  FIMP: { lat: -20.4302, lon: 57.6836, elevFt: 186 }, // Sir Seewoosagur Ramgoolam International Airport
  FMMI: { lat: -18.7969, lon: 47.4788, elevFt: 4198 }, // Ivato Airport
  HKJK: { lat: -1.3192, lon: 36.9278, elevFt: 5330 }, // Jomo Kenyatta International Airport
  HRYR: { lat: -1.9686, lon: 30.1395, elevFt: 4859 }, // Kigali International Airport
  HTDA: { lat: -6.8781, lon: 39.2026, elevFt: 182 }, // Mwalimu Julius K. Nyerere International Airport
  FLKK: { lat: -15.3308, lon: 28.4526, elevFt: 3779 }, // Kenneth Kaunda International Airport
  FQMA: { lat: -25.9208, lon: 32.5726, elevFt: 145 }, // Maputo Airport
  FAOR: { lat: -26.1333, lon: 28.2500, elevFt: 5558 }, // O. R. Tambo International Airport
  FALE: { lat: -29.6144, lon: 31.1197, elevFt: 295 }, // King Shaka International Airport
  FACT: { lat: -33.9648, lon: 18.6017, elevFt: 151 }, // Cape Town International Airport
  FYWH: { lat: -22.4799, lon: 17.4709, elevFt: 5640 }, // Hosea Kutako International Airport (Windhoek)
  FNBJ: { lat: -9.0468, lon: 13.5072, elevFt: 522 }, // Dr. Antonio Agostinho Neto International Airport (Luanda)
  DNMM: { lat: 6.5774, lon: 3.3212, elevFt: 135 }, // Murtala Muhammed International Airport
  GFLL: { lat: 8.6164, lon: -13.1955, elevFt: 84 }, // Lungi International Airport
  GOBD: { lat: 14.6711, lon: -17.0669, elevFt: 289 }, // Blaise Diagne International Airport
  SBFZ: { lat: -3.7763, lon: -38.5326, elevFt: 82 }, // Pinto Martins International Airport
  SBGL: { lat: -22.8100, lon: -43.2506, elevFt: 28 }, // Galeao - Antonio Carlos Jobim International Airport
  SBGR: { lat: -23.4356, lon: -46.4731, elevFt: 2459 }, // Guarulhos International Airport
  SGAS: { lat: -25.2400, lon: -57.5200, elevFt: 292 }, // Silvio Pettirossi International Airport
  SABE: { lat: -34.5592, lon: -58.4156, elevFt: 18 }, // Jorge Newbery Airpark
  SCEL: { lat: -33.3930, lon: -70.7858, elevFt: 1555 }, // Comodoro Arturo Merino Benitez International Airport
  SLLP: { lat: -16.5133, lon: -68.1923, elevFt: 13355 }, // El Alto International Airport
  SEQM: { lat: -0.1292, lon: -78.3575, elevFt: 9200 }, // Mariscal Sucre International Airport
  SKPS: { lat: 1.3962, lon: -77.2915, elevFt: 5951 }, // Antonio Narino Airport
  SKBO: { lat: 4.7016, lon: -74.1469, elevFt: 8361 }, // El Dorado International Airport
  SVCS: { lat: 10.2861, lon: -66.8161, elevFt: 2145 }, // Oscar Machado Zuluaga Airport
  TVSA: { lat: 13.1627, lon: -61.1514, elevFt: 109 }, // Argyle International Airport
  TNCM: { lat: 18.0410, lon: -63.1089, elevFt: 13 }, // Princess Juliana International Airport
  MKJS: { lat: 18.5037, lon: -77.9134, elevFt: 4 }, // Sangster International Airport
  MHTG: { lat: 14.0609, lon: -87.2172, elevFt: 3294 }, // Toncontin International Airport
  MMMX: { lat: 19.4363, lon: -99.0721, elevFt: 7316 }, // Licenciado Benito Juarez International Airport
  MMSD: { lat: 23.1518, lon: -109.7210, elevFt: 374 }, // Los Cabos International Airport
  KSAN: { lat: 32.7336, lon: -117.1900, elevFt: 17 }, // San Diego International Airport
  YBAS: { lat: -23.8067, lon: 133.9020, elevFt: 1789 }, // Alice Springs Airport
  WICA: { lat: -6.6477, lon: 108.1658, elevFt: 134 }, // Majalengka Kertajati International Airport
  VTSP: { lat: 8.1132, lon: 98.3169, elevFt: 82 }, // Phuket International Airport
  FHAW: { lat: -7.9696, lon: -14.3937, elevFt: 278 }, // RAF Ascension Island (Wideawake)
  EGYP: { lat: -51.8228, lon: -58.4472, elevFt: 244 }, // Mount Pleasant Airport, Falkland Islands
  SAWH: { lat: -54.8433, lon: -68.2958, elevFt: 102 }, // Malvinas Argentinas Airport, Ushuaia
  SBEG: { lat: -3.0386, lon: -60.0497, elevFt: 264 }, // Eduardo Gomes International Airport, Manaus
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