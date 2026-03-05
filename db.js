
import Database from "better-sqlite3";

export function openDb(path = "./rtw.sqlite") {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS route_legs (
      guild_id TEXT,
      leg_index INTEGER,
      from_icao TEXT,
      to_icao TEXT,
      PRIMARY KEY (guild_id, leg_index)
    );

    CREATE TABLE IF NOT EXISTS completions (
      guild_id TEXT,
      discord_id TEXT,
      leg_index INTEGER,
      completed_at TEXT,
      PRIMARY KEY (guild_id, discord_id, leg_index)
    );

    CREATE TABLE IF NOT EXISTS user_links (
      guild_id TEXT,
      discord_id TEXT,
      vatsim_cid TEXT,
      PRIMARY KEY (guild_id, discord_id)
    );
  `);
  return db;
}
