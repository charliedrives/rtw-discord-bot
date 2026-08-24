import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export function openDb(dbPath = process.env.RTW_DB_PATH || "./data/rtw.sqlite") {
  const dbDir = path.dirname(dbPath);
  if (dbDir && dbDir !== ".") {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  console.log("[db] opening sqlite database:", dbPath);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      announce_channel_id TEXT,
      daily_channel_id TEXT,
      daily_time TEXT
    );

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
      source TEXT NOT NULL, -- 'manual' or 'vatsim'
      dep TEXT NOT NULL,
      arr TEXT NOT NULL,
      PRIMARY KEY (guild_id, discord_id, leg_index)
    );

    CREATE TABLE IF NOT EXISTS user_links (
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      vatsim_cid TEXT NOT NULL,
      discord_name TEXT,
      linked_at TEXT,
      PRIMARY KEY (guild_id, discord_id),
      UNIQUE (guild_id, vatsim_cid)
    );

    CREATE TABLE IF NOT EXISTS route_legs_archive (
      season TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      leg_index INTEGER NOT NULL,
      from_icao TEXT NOT NULL,
      to_icao TEXT NOT NULL,
      archived_at TEXT NOT NULL,
      PRIMARY KEY (season, guild_id, leg_index)
    );

    CREATE TABLE IF NOT EXISTS completions_archive (
      season TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      leg_index INTEGER NOT NULL,
      completed_at TEXT NOT NULL,
      source TEXT NOT NULL,
      dep TEXT NOT NULL,
      arr TEXT NOT NULL,
      archived_at TEXT NOT NULL,
      PRIMARY KEY (season, guild_id, discord_id, leg_index)
    );
  `);

  // Lightweight migrations (safe if already applied)
  try { db.exec(`ALTER TABLE guild_settings ADD COLUMN announce_channel_id TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE guild_settings ADD COLUMN daily_channel_id TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE guild_settings ADD COLUMN daily_time TEXT;`); } catch {}

  try { db.exec(`ALTER TABLE completions ADD COLUMN source TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE completions ADD COLUMN dep TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE completions ADD COLUMN arr TEXT;`); } catch {}

  // New: store friendly name + link timestamp
  try { db.exec(`ALTER TABLE user_links ADD COLUMN discord_name TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE user_links ADD COLUMN linked_at TEXT;`); } catch {}

  return db;
}
