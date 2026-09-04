import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Serve built frontend ───────────────────────────────────────────────────
// Local production mode. On Vercel the static files are served by Vercel's
// CDN (see vercel.json) and this dir isn't part of the function bundle, so
// the existsSync guard keeps the function from 500-ing on missing dist.
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}

// ═══════════════════════════════════════════════════════════════════
//  GET /api/cameras  – list all cameras (optionally filtered)
// ═══════════════════════════════════════════════════════════════════
app.get('/api/cameras', (req, res) => {
  const { zone, floor, status } = req.query;
  let sql = 'SELECT * FROM camera_assets WHERE 1=1';
  const params = [];

  if (zone)   { sql += ' AND zone_id = ?';      params.push(zone.toUpperCase()); }
  if (floor !== undefined) { sql += ' AND floor_number = ?'; params.push(Number(floor)); }
  if (status) { sql += ' AND current_status = ?'; params.push(status); }
  sql += ' ORDER BY zone_id, floor_number, camera_name';

  res.json(db.prepare(sql).all(...params));
});

// ═══════════════════════════════════════════════════════════════════
//  GET /api/cameras/:id  – single camera
// ═══════════════════════════════════════════════════════════════════
app.get('/api/cameras/:id', (req, res) => {
  const cam = db.prepare('SELECT * FROM camera_assets WHERE camera_id = ?').get(req.params.id);
  if (!cam) return res.status(404).json({ error: 'Camera not found' });
  res.json(cam);
});

// ═══════════════════════════════════════════════════════════════════
//  POST /api/cameras  – add new camera
// ═══════════════════════════════════════════════════════════════════
app.post('/api/cameras', (req, res) => {
  const { camera_name, zone_id, floor_number, static_ip_address, mac_address,
          rtsp_stream_url, latitude, longitude, azimuth_angle, field_of_view, current_status } = req.body;

  try {
    const result = db.prepare(`
      INSERT INTO camera_assets
        (camera_name, zone_id, floor_number, static_ip_address, mac_address,
         rtsp_stream_url, latitude, longitude, azimuth_angle, field_of_view, current_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(camera_name, zone_id, floor_number, static_ip_address, mac_address,
           rtsp_stream_url, latitude, longitude, azimuth_angle, field_of_view ?? 60,
           current_status ?? 'Online');

    const cam = db.prepare('SELECT * FROM camera_assets WHERE camera_id = ?').get(result.lastInsertRowid);
    res.status(201).json(cam);
  } catch (e) {
    const msg = e.message.includes('UNIQUE constraint failed: camera_assets.static_ip_address')
      ? `IP address ${req.body.static_ip_address} is already in use by another camera — please choose a different one.`
      : e.message;
    res.status(409).json({ error: msg });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  PUT /api/cameras/:id  – update camera
// ═══════════════════════════════════════════════════════════════════
app.put('/api/cameras/:id', (req, res) => {
  const cam = db.prepare('SELECT * FROM camera_assets WHERE camera_id = ?').get(req.params.id);
  if (!cam) return res.status(404).json({ error: 'Camera not found' });

  const merged = { ...cam, ...req.body };
  db.prepare(`
    UPDATE camera_assets SET
      camera_name=?, zone_id=?, floor_number=?, static_ip_address=?, mac_address=?,
      rtsp_stream_url=?, latitude=?, longitude=?, azimuth_angle=?, field_of_view=?, current_status=?
    WHERE camera_id=?
  `).run(merged.camera_name, merged.zone_id, merged.floor_number, merged.static_ip_address,
         merged.mac_address, merged.rtsp_stream_url, merged.latitude, merged.longitude,
         merged.azimuth_angle, merged.field_of_view, merged.current_status, req.params.id);

  try {
    res.json(db.prepare('SELECT * FROM camera_assets WHERE camera_id = ?').get(req.params.id));
  } catch (e) {
    const msg = e.message.includes('UNIQUE constraint failed: camera_assets.static_ip_address')
      ? `IP address ${req.body.static_ip_address} is already in use by another camera — please choose a different one.`
      : e.message;
    res.status(409).json({ error: msg });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  DELETE /api/cameras/:id
// ═══════════════════════════════════════════════════════════════════
app.delete('/api/cameras/:id', (req, res) => {
  const info = db.prepare('DELETE FROM camera_assets WHERE camera_id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Camera not found' });
  res.json({ deleted: true });
});

// ═══════════════════════════════════════════════════════════════════
//  POST /api/cameras/:id/ping  – simulate status check
// ═══════════════════════════════════════════════════════════════════
app.post('/api/cameras/:id/ping', (req, res) => {
  const cam = db.prepare('SELECT * FROM camera_assets WHERE camera_id = ?').get(req.params.id);
  if (!cam) return res.status(404).json({ error: 'Camera not found' });

  // Simulate network response
  const rnd = Math.random();
  let newStatus, latency, packetLoss;

  if (cam.current_status === 'Offline') {
    // Offline cams rarely come back
    newStatus  = rnd > 0.9 ? 'Degraded' : 'Offline';
    latency    = newStatus === 'Offline' ? null : 980 + Math.round(Math.random() * 200);
    packetLoss = newStatus === 'Offline' ? 100 : 40 + Math.round(Math.random() * 30);
  } else {
    newStatus  = rnd > 0.85 ? 'Degraded' : rnd > 0.05 ? 'Online' : 'Offline';
    latency    = newStatus === 'Online' ? 5 + Math.round(Math.random() * 40)
               : newStatus === 'Degraded' ? 200 + Math.round(Math.random() * 600)
               : null;
    packetLoss = newStatus === 'Online' ? Math.round(Math.random() * 2)
               : newStatus === 'Degraded' ? 15 + Math.round(Math.random() * 40)
               : 100;
  }

  db.prepare('UPDATE camera_assets SET current_status = ? WHERE camera_id = ?')
    .run(newStatus, req.params.id);

  res.json({ camera_id: cam.camera_id, status: newStatus, latency_ms: latency, packet_loss_pct: packetLoss });
});

// ═══════════════════════════════════════════════════════════════════
//  POST /api/ping-all  – ping every camera (background health sweep)
// ═══════════════════════════════════════════════════════════════════
app.post('/api/ping-all', (req, res) => {
  const cameras = db.prepare('SELECT camera_id, current_status FROM camera_assets').all();
  const results = cameras.map(cam => {
    const rnd = Math.random();
    let newStatus;
    if (cam.current_status === 'Offline') {
      newStatus = rnd > 0.92 ? 'Degraded' : 'Offline';
    } else {
      newStatus = rnd > 0.88 ? 'Degraded' : rnd > 0.04 ? 'Online' : 'Offline';
    }
    db.prepare('UPDATE camera_assets SET current_status = ? WHERE camera_id = ?')
      .run(newStatus, cam.camera_id);
    return { camera_id: cam.camera_id, status: newStatus };
  });
  res.json({ swept: results.length, results });
});

// ═══════════════════════════════════════════════════════════════════
//  GET /api/stats  – system-wide pulse metrics
// ═══════════════════════════════════════════════════════════════════
app.get('/api/stats', (req, res) => {
  const total   = db.prepare('SELECT COUNT(*) AS c FROM camera_assets').get().c;
  const online  = db.prepare("SELECT COUNT(*) AS c FROM camera_assets WHERE current_status='Online'").get().c;
  const offline = db.prepare("SELECT COUNT(*) AS c FROM camera_assets WHERE current_status='Offline'").get().c;
  const degraded = db.prepare("SELECT COUNT(*) AS c FROM camera_assets WHERE current_status='Degraded'").get().c;

  const byZone = db.prepare(`
    SELECT zone_id,
           COUNT(*) AS total,
           SUM(CASE WHEN current_status='Online'   THEN 1 ELSE 0 END) AS online,
           SUM(CASE WHEN current_status='Offline'  THEN 1 ELSE 0 END) AS offline,
           SUM(CASE WHEN current_status='Degraded' THEN 1 ELSE 0 END) AS degraded
    FROM camera_assets
    GROUP BY zone_id
  `).all();

  res.json({
    total, online, offline, degraded,
    uptime_pct: total > 0 ? +((online / total) * 100).toFixed(1) : 0,
    avg_latency_ms: online * 22 + degraded * 380,  // estimated
    bandwidth_mbps: +(online * 2.4).toFixed(1),
    nvr_host: '192.168.1.254',
    nvr_status: 'Online',
    byZone,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════════
//  GET /api/search?q=  – unified hierarchical search
// ═══════════════════════════════════════════════════════════════════
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  // Try direct IP
  const byIp = db.prepare('SELECT * FROM camera_assets WHERE static_ip_address = ?').get(q);
  if (byIp) return res.json([byIp]);

  // Parse "ZONE Floor N" pattern e.g. "CB Floor 5", "Food Street Floor 2", "AB1 3"
  const zoneMap = { 'cb':'CB','central block':'CB','fs':'FS','food street':'FS',
                    'ab1':'AB1','academic block 1':'AB1','ab2':'AB2','academic block 2':'AB2',
                    'rp':'RP','rock plaza':'RP' };
  const lower = q.toLowerCase();
  let matchedZone = null;
  let matchedFloor = null;

  for (const [key, val] of Object.entries(zoneMap)) {
    if (lower.includes(key)) { matchedZone = val; break; }
  }

  const floorMatch = lower.match(/floor[\s_-]?(\d)|(\d)\s*(?:f|fl|floor)/i)
                  || lower.match(/\b(\d)\b/);
  if (floorMatch) matchedFloor = parseInt(floorMatch[1] ?? floorMatch[2]);

  if (matchedZone && matchedFloor !== null) {
    return res.json(
      db.prepare('SELECT * FROM camera_assets WHERE zone_id=? AND floor_number=? ORDER BY camera_name')
        .all(matchedZone, matchedFloor)
    );
  }
  if (matchedZone) {
    return res.json(
      db.prepare('SELECT * FROM camera_assets WHERE zone_id=? ORDER BY floor_number, camera_name')
        .all(matchedZone)
    );
  }

  // Full-text name search
  const byName = db.prepare(
    "SELECT * FROM camera_assets WHERE camera_name LIKE ? ORDER BY camera_name LIMIT 20"
  ).all(`%${q}%`);
  res.json(byName);
});

// ─── SPA fallback ──────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  const indexHtml = path.join(distDir, 'index.html');
  if (fs.existsSync(indexHtml)) return res.sendFile(indexHtml);
  res.status(404).json({ error: 'Not found' });
});

export default app;