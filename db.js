import Database from "better-sqlite3";

export function openDb(path = "./rtw.sqlite") {
  const db = new Database(path);

  db.exec(`
    CREATE TABLE IF NOT EXISTS route_legs (
      guild_id TEXT NOT NULL,
      leg_index INTEGER NOT NULL,
      from_icao TEXT NOT NULL,
      to_icao TEXT NOT NULL,
      PRIMARY KEY (guild_id, leg_index)
    );

    CREATE TABLE IF NOT EXISTS completions (
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      leg_index INTEGER NOT NULL,
      completed_at TEXT NOT NULL,
      PRIMARY KEY (guild_id, discord_id, leg_index)
    );

    CREATE TABLE IF NOT EXISTS user_links (
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      vatsim_cid TEXT NOT NULL,
      PRIMARY KEY (guild_id, discord_id),
      UNIQUE (guild_id, vatsim_cid)
    );
  `);

  return db;
}