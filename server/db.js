import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateCameras } from './camera-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── DB location ────────────────────────────────────────────────────────────
// Vercel serverless functions have a read-only filesystem EXCEPT /tmp, so the
// SQLite file lives there on Vercel. Locally (dev / preview) it stays in
// data/cammap.db as before. Override with DB_PATH env var if needed.
const DB_PATH = process.env.DB_PATH
  ?? (process.env.VERCEL === '1'
      ? '/tmp/cammap.db'
      : path.join(__dirname, '..', 'data', 'cammap.db'));

if (DB_PATH !== ':memory:') {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS camera_assets (
    camera_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_name  TEXT NOT NULL,
    zone_id      TEXT NOT NULL CHECK(zone_id IN ('CB','FS','AB1','AB2','RP')),
    floor_number INTEGER NOT NULL,
    static_ip_address TEXT NOT NULL UNIQUE,
    mac_address  TEXT NOT NULL,
    rtsp_stream_url TEXT NOT NULL,
    latitude     REAL NOT NULL,
    longitude    REAL NOT NULL,
    azimuth_angle INTEGER CHECK(azimuth_angle BETWEEN 0 AND 360),
    field_of_view INTEGER DEFAULT 60,
    current_status TEXT DEFAULT 'Online'
  );
`);

// ── Vercel cold-start auto-seed ────────────────────────────────────────────
// Every fresh serverless instance gets its own empty /tmp DB — seed it
// immediately so the map is never empty. The dataset is deterministic, so
// all instances agree. (Local dev never auto-seeds; `npm run seed` controls it.)
if (process.env.VERCEL === '1') {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM camera_assets').get();
  if (c === 0) {
    const insert = db.prepare(`
      INSERT INTO camera_assets
        (camera_name, zone_id, floor_number, static_ip_address, mac_address,
         rtsp_stream_url, latitude, longitude, azimuth_angle, field_of_view, current_status)
      VALUES
        (@camera_name, @zone_id, @floor_number, @static_ip_address, @mac_address,
         @rtsp_stream_url, @latitude, @longitude, @azimuth_angle, @field_of_view, @current_status)
    `);
    const seedAll = db.transaction(() => {
      generateCameras(25).forEach(cam => insert.run(cam));
    });
    seedAll();
    const total = db.prepare('SELECT COUNT(*) AS c FROM camera_assets').get().c;
    console.log(`[cammap] Vercel cold start: auto-seeded ${total} cameras into ${DB_PATH}`);
  }
}

export default db;