import db from './db.js';
import { generateCameras } from './camera-generator.js';

// ---------------------------------------------------------------------------
// Configuration — bump CAMS_PER_FLOOR to scale every zone up or down
// ---------------------------------------------------------------------------
const CAMS_PER_FLOOR = 25;                       // cameras per floor per zone

// ---------------------------------------------------------------------------
// Seed (wipes the table first — `npm run seed` resets the whole dataset)
// ---------------------------------------------------------------------------
const cameras = generateCameras(CAMS_PER_FLOOR);

const insertStmt = db.prepare(`
  INSERT INTO camera_assets
    (camera_name, zone_id, floor_number, static_ip_address, mac_address,
     rtsp_stream_url, latitude, longitude, azimuth_angle, field_of_view, current_status)
  VALUES
    (@camera_name, @zone_id, @floor_number, @static_ip_address, @mac_address,
     @rtsp_stream_url, @latitude, @longitude, @azimuth_angle, @field_of_view, @current_status)
`);

const seedAll = db.transaction(() => {
  db.prepare('DELETE FROM camera_assets').run();
  cameras.forEach(c => insertStmt.run(c));
});

seedAll();
console.log(`✅  Seeded ${cameras.length} cameras (${CAMS_PER_FLOOR} per floor) across CB(0-8), FS(0-4), AB1(0-4), AB2(0-4), RP(0-4).`);