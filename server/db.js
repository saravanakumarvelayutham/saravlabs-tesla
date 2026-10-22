// SQLite storage using Node's built-in node:sqlite (Node 22.13+), so there is no native build step on the Pi or server.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS latest (
  field TEXT PRIMARY KEY,
  value TEXT,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
  field TEXT NOT NULL,
  value TEXT,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_field_ts ON history(field, ts);
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER,
  start_odo REAL, end_odo REAL,
  start_energy REAL, end_energy REAL,
  start_soc REAL, end_soc REAL,
  start_place TEXT, end_place TEXT,
  outside_temp REAL,
  max_speed REAL,
  route TEXT
);
CREATE TABLE IF NOT EXISTS charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER,
  start_soc REAL, end_soc REAL,
  at_home INTEGER,
  fast_charger TEXT,
  peak_kw REAL,
  energy_battery_kwh REAL,
  energy_wall_kwh REAL,
  dc INTEGER,
  curve TEXT
);
CREATE TABLE IF NOT EXISTS tire_daily (
  day TEXT NOT NULL,
  tire TEXT NOT NULL,
  psi REAL NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (day, tire)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data TEXT
);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT
);
CREATE TABLE IF NOT EXISTS bridge_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  command TEXT NOT NULL,
  args TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  result TEXT,
  done_ts INTEGER
);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function kvGet(db, k, fallback = null) {
  const row = db.prepare('SELECT v FROM kv WHERE k = ?').get(k);
  return row ? JSON.parse(row.v) : fallback;
}

export function kvSet(db, k, v) {
  db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v));
}
