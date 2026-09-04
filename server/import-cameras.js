#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
//  Bulk-import cameras from a CSV file (real camera data).
//
//  Usage:  npm run import -- path/to/cameras.csv
//          (or: node server/import-cameras.js path/to/cameras.csv)
//
//  CSV column order (only the first 4 are required):
//    camera_name, zone_id, floor_number, static_ip_address,
//    mac_address, latitude, longitude, azimuth_angle, field_of_view,
//    current_status
//
//  Optional fields can be left empty. Missing values are filled in:
//    - mac_address    -> auto-generated (unique per IP)
//    - latitude/longitude -> camera auto-placed near the zone centre
//                            (deterministic, so re-imports don't move it)
//    - azimuth_angle  -> 0
//    - field_of_view  -> 60
//    - current_status -> 'Online'
//    - RTSP URL is always rebuilt from the IP.
//
//  Cameras whose IP already exists in the database are SKIPPED (never
//  overwritten) — re-running the import is safe.
// ─────────────────────────────────────────────────────────────────────
import db from './db.js';
import fs from 'fs';
import { ZONE_CENTER, FLOOR_MAX } from '../src/zoneData.js';

const ZONES = ['CB','FS','AB1','AB2','RP'];

// ── small deterministic hash + PRNG ──────────────────────────────────
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function autoMac(ip) {
  const h = hashStr(ip);
  return [0x02, 0x00, (h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff]
    .map(v => v.toString(16).padStart(2, '0')).join(':');
}

function autoPosition(zone, floor, ip) {
  const [clat, clng] = ZONE_CENTER[zone];
  const seed = hashStr(`${ip}:${floor}`);
  const angle = (seed % 360) * Math.PI / 180;
  const dist  = 0.00010 + (seed % 120) * 0.0000015;   // ~11–28 m from centre
  return {
    lat: +(clat + Math.cos(angle) * dist).toFixed(8),
    lng: +(clng + Math.sin(angle) * dist).toFixed(8),
  };
}

// ── minimal CSV parser (handles Excel "Save As CSV" output) ──────────
function parseCsv(text) {
  return text.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split(',').map(f => f.trim().replace(/^"|"$/g, '')));
}

// ── main ─────────────────────────────────────────────────────────────
const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run import -- path/to/cameras.csv');
  process.exit(1);
}

const rows = parseCsv(fs.readFileSync(file, 'utf8'));
if (!rows.length) { console.error('CSV file is empty.'); process.exit(1); }

// Skip a header row if present
if (rows[0][0] && rows[0][0].toLowerCase().includes('camera_name')) rows.shift();

const existing = db.prepare('SELECT static_ip_address FROM camera_assets').all();
const usedIps  = new Set(existing.map(r => r.static_ip_address));

const insert = db.prepare(`
  INSERT INTO camera_assets
    (camera_name, zone_id, floor_number, static_ip_address, mac_address,
     rtsp_stream_url, latitude, longitude, azimuth_angle, field_of_view, current_status)
  VALUES
    (@camera_name, @zone_id, @floor_number, @static_ip_address, @mac_address,
     @rtsp_stream_url, @latitude, @longitude, @azimuth_angle, @field_of_view, @current_status)
`);

let added = 0;
let skipped = 0;
const errors = [];

const run = db.transaction(() => {
  rows.forEach((r, i) => {
    const [name, zone, floor, ip, mac = '', lat = '', lng = '', az = '', fov = '', status = ''] = r;

    // Validate required fields
    if (!name || !ip || !zone) {
      errors.push(`row ${i + 1}: missing camera_name / zone_id / static_ip_address — skipped`);
      return;
    }
    if (!ZONES.includes(zone.toUpperCase())) {
      errors.push(`row ${i + 1}: unknown zone "${zone}" (allowed: ${ZONES.join(', ')}) — skipped`);
      return;
    }
    const floorNum = Number(floor);
    if (!Number.isInteger(floorNum) || floorNum < 0) {
      errors.push(`row ${i + 1}: invalid floor "${floor}" — skipped`);
      return;
    }
    if (FLOOR_MAX[zone] !== undefined && floorNum > FLOOR_MAX[zone]) {
      console.warn(`  ⚠ row ${i + 1}: floor ${floorNum} exceeds ${zone}'s max (${FLOOR_MAX[zone]}) — importing anyway`);
    }

    // Duplicate IP guard (UNIQUE constraint)
    if (usedIps.has(ip)) {
      console.warn(`  ⚠ skipped duplicate IP: ${ip} (${name})`);
      skipped++;
      return;
    }
    usedIps.add(ip);

    const finalMac  = mac || autoMac(ip);
    const hasPos    = lat !== '' && lng !== '' && !isNaN(Number(lat)) && !isNaN(Number(lng));
    const pos       = hasPos ? { lat: Number(lat), lng: Number(lng) } : autoPosition(zone.toUpperCase(), floorNum, ip);

    insert.run({
      camera_name:       name,
      zone_id:           zone.toUpperCase(),
      floor_number:      floorNum,
      static_ip_address: ip,
      mac_address:       finalMac,
      rtsp_stream_url:   `rtsp://${ip}:554/live/stream1`,
      latitude:          pos.lat,
      longitude:         pos.lng,
      azimuth_angle:     az !== '' ? Number(az) % 360 : 0,
      field_of_view:     fov !== '' ? Number(fov) : 60,
      current_status:    status || 'Online',
    });
    added++;
  });
});

run();

console.log(`\n✅  Imported ${added} camera(s) from ${file}`);
console.log(`    skipped ${skipped} (duplicate IPs), ${errors.length} invalid row(s)`);
errors.forEach(e => console.log(`    - ${e}`));
console.log(`    total cameras now: ${db.prepare('SELECT COUNT(*) c FROM camera_assets').get().c}`);