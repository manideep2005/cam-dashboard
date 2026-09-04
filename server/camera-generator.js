// ─────────────────────────────────────────────────────────────────────
//  Shared camera-generation logic (deterministic).
//
//  Used by:
//    - server/seed.js          → local `npm run seed`
//    - server/db.js            → Vercel cold start (auto-seed when empty)
//
//  Positions, IPs and MACs are fully deterministic, so every Vercel
//  instance that auto-seeds produces the exact same dataset.
// ─────────────────────────────────────────────────────────────────────
import { FLOOR_MAX, zoneBounds } from '../src/zoneData.js';

const ZONE_SUBNET = { FS: 20, AB1: 30, AB2: 40, RP: 50 };  // CB uses 192.168.1{f}

// Descriptive name pool per zone — first few cameras per floor keep these
const NAME_POOL = {
  CB:  ['Corridor-North','Corridor-South','Corridor-East','Corridor-West','Lobby'],
  FS:  ['Entrance','FoodCourt-Main','Kitchen-Row','Seating-East','Seating-West'],
  AB1: ['Main-Hall','Lab-Wing','Library','Seminar-Hall','Stairwell'],
  AB2: ['Atrium','Classroom-Wing','Faculty-Zone','Server-Closet','Exit-Ramp'],
  RP:  ['Plaza-Center','Stage-Area','North-Gate','East-Path','Amphitheatre'],
};

function mac(a, b, c, d, e, f) {
  return [a, b, c, d, e, f].map(v => v.toString(16).padStart(2, '0')).join(':');
}

function rtsp(ip) {
  return `rtsp://${ip}:554/live/stream1`;
}

// Deterministic PRNG so re-seeding produces the same layout every time
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Position inside the zone footprint. Uses a grid base plus a per-floor,
// per-camera jitter so different floors fan out ACROSS the whole polygon
// instead of stacking on the same spots.
function layoutPoint(zone, floor, idx, total, rnd) {
  const b = zoneBounds(zone);
  const cols = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / cols);
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  // ±0.45 cell jitter, clamped so cameras stay inside the polygon
  const fx = Math.min(0.92, Math.max(0.08, 0.12 + 0.76 * ((col + 0.5 + (rnd() - 0.5) * 0.9) / cols)));
  const fy = Math.min(0.92, Math.max(0.08, 0.12 + 0.76 * ((row + 0.5 + (rnd() - 0.5) * 0.9) / rows)));
  return {
    lat: +(b.minLat + fy * (b.maxLat - b.minLat)).toFixed(8),
    lng: +(b.minLng + fx * (b.maxLng - b.minLng)).toFixed(8),
  };
}

// First free host in the zone's subnet (CB has its own subnet per floor,
// other zones share one subnet across all floors → hosts must be unique zone-wide)
function nextHost(usedHosts, zone, floor) {
  const key    = zone === 'CB' ? `${zone}:${floor}` : zone;
  const prefix = zone === 'CB' ? `192.168.1${floor}` : `192.168.${ZONE_SUBNET[zone]}`;
  if (!usedHosts[key]) usedHosts[key] = new Set();
  let host = 10;
  while (usedHosts[key].has(host)) host++;
  usedHosts[key].add(host);
  return `${prefix}.${host}`;
}

// Deterministic status mix: mostly online, a few degraded / offline
function statusFor(idx) {
  if (idx % 11 === 0) return 'Offline';
  if (idx % 5  === 0) return 'Degraded';
  return 'Online';
}

export function generateCameras(camsPerFloor = 25) {
  const cameras = [];
  let macCounter = 1;
  const usedHosts = {};   // key → Set of host numbers in use

  function addCamera(zone, floor, idx, total, rnd) {
    const pool = NAME_POOL[zone];
    const name = idx < pool.length
      ? `${zone}-FL${floor}-${pool[idx]}`
      : `${zone}-FL${floor}-Cam-${String(idx + 1).padStart(2, '0')}`;
    const ip  = nextHost(usedHosts, zone, floor);
    const pos = layoutPoint(zone, floor, idx, total, rnd);
    cameras.push({
      camera_name:       name,
      zone_id:           zone,
      floor_number:      floor,
      static_ip_address: ip,
      mac_address:       mac(0xAA, 0xBB, zone.charCodeAt(0), floor, Math.floor(macCounter / 256), macCounter++ % 256),
      rtsp_stream_url:   rtsp(ip),
      latitude:          pos.lat,
      longitude:         pos.lng,
      azimuth_angle:     (idx * Math.floor(360 / camsPerFloor) + floor * 11) % 360,
      field_of_view:     55 + ((idx * 7) % 36),
      current_status:    statusFor(idx),
    });
  }

  Object.entries(FLOOR_MAX).forEach(([zone, maxFloors]) => {
    for (let floor = 0; floor <= maxFloors; floor++) {
      // per-floor PRNG seed → every floor scatters differently across the polygon
      const rnd = mulberry32(hashSeed(`${zone}:${floor}`));
      for (let i = 0; i < camsPerFloor; i++) addCamera(zone, floor, i, camsPerFloor, rnd);
    }
  });

  return cameras;
}