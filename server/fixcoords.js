// Repair camera coordinates that drifted off the campus footprint.
//
// The camera_assets table was at some point seeded/populated with positions
// hundreds of km away from the campus centres that every zone constant in the
// app (map centre, FOA cones, polygons) and server/seed.js use. Rows whose
// position is clearly off-centre are recomputed with the exact same
// deterministic layout math as server/seed.js, keyed off the camera's own
// zone / floor / location name. Only the latitude & longitude columns of
// out-of-range rows are touched.
import db from './db.js';

const SPREAD = 0.00015;

const ZONE_CENTERS = {
  CB:  { lat: 16.494381, lng: 80.499227 },
  FS:  { lat: 16.493792, lng: 80.498364 },
  AB1: { lat: 16.495774, lng: 80.500351 },
  AB2: { lat: 16.495772, lng: 80.498164 },
  RP:  { lat: 16.496000, lng: 80.499000 },
};

// Location name order per zone — must mirror the addCamera loops in server/seed.js
const LOCS = {
  CB:  ['Corridor-North', 'Corridor-South', 'Corridor-East', 'Corridor-West', 'Lobby'],
  FS:  ['Entrance', 'FoodCourt-Main', 'Kitchen-Row', 'Seating-East', 'Seating-West'],
  AB1: ['Main-Hall', 'Lab-Wing', 'Library', 'Seminar-Hall', 'Stairwell'],
  AB2: ['Atrium', 'Classroom-Wing', 'Faculty-Zone', 'Server-Closet', 'Exit-Ramp'],
  RP:  ['Plaza-Center', 'Stage-Area', 'North-Gate', 'East-Path', 'Amphitheatre'],
};

function jitter(base, idx, total, floorOffset) {
  const angle = (idx / total) * 2 * Math.PI;
  return {
    lat: +(base.lat + Math.cos(angle) * SPREAD + floorOffset * 0.0000008).toFixed(8),
    lng: +(base.lng + Math.sin(angle) * SPREAD).toFixed(8),
  };
}

const rows = db.prepare(
  'SELECT camera_id, camera_name, zone_id, floor_number, latitude, longitude FROM camera_assets'
).all();
const update = db.prepare('UPDATE camera_assets SET latitude = ?, longitude = ? WHERE camera_id = ?');

let fixed = 0;
let skipped = 0;
for (const row of rows) {
  const locs = LOCS[row.zone_id];
  if (!locs) { skipped++; continue; }

  const locName = locs.find(l => String(row.camera_name || '').endsWith(l));
  if (!locName) { skipped++; continue; }

  const idx   = locs.indexOf(locName);
  const total = locs.length;
  const pos   = jitter(ZONE_CENTERS[row.zone_id], idx, total, row.floor_number);

  const centre = ZONE_CENTERS[row.zone_id];
  const onCampus = Math.abs(row.latitude - centre.lat) < 0.05
                && Math.abs(row.longitude - centre.lng) < 0.05;
  if (!onCampus) {
    update.run(pos.lat, pos.lng, row.camera_id);
    fixed++;
  }
}

console.log(`✅ Repositioned ${fixed} camera(s) onto the campus footprint (${skipped} unmatched/skipped).`);
db.close();
