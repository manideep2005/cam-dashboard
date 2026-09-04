import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import L from 'leaflet';
import GoogleMutant from 'leaflet.gridlayer.googlemutant';
import osmtogeojson from 'osmtogeojson';
import { Layers, Navigation } from 'lucide-react';
import { ZONE_COLOR, ZONE_NAME, ZONE_POLYGONS, ZONE_CENTER, FLOOR_MAX } from '../zoneData.js';

const STATUS_COLOR = { Online:'#10b981', Offline:'#ef4444', Degraded:'#f59e0b' };

// ── Build custom DivIcon ──────────────────────────────────────────────
function buildPinIcon(status, selected, flash, opts = {}) {
  const { animate = true, delay = 0 } = opts;
  const color = STATUS_COLOR[status] ?? '#94a3b8';
  const size  = selected ? 44 : 34;
  const ring  = selected ? `box-shadow:0 0 0 3px ${color}44,0 0 18px ${color}88;` : `box-shadow:0 0 8px ${color}88;`;
  // Pop in on creation (staggered via delay); pin-flash while being located;
  // refreshes (selection changes) rebuild icons without re-popping everything.
  const anim  = flash
    ? 'animation:pin-flash 0.5s ease-in-out 4;'
    : animate
      ? `animation:pin-pop 0.35s cubic-bezier(0.16,1,0.3,1) both;animation-delay:${delay}ms;`
      : '';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color}22;border:2px solid ${color};
      display:flex;align-items:center;justify-content:center;
      font-size:14px;cursor:pointer;transition:all 0.2s;
      ${ring}${anim}
    ">📷</div>`,
    iconSize:   [size, size],
    iconAnchor: [size/2, size/2],
  });
}

// ── Popup card shown when a camera pin is clicked ─────────────────────
function camPopupHtml(cam) {
  const color = STATUS_COLOR[cam.current_status] ?? '#94a3b8';
  return `<div class="cam-popup-inner">
    <div class="cp-name">${cam.camera_name}</div>
    <div class="cp-status" style="color:${color}">● ${cam.current_status}</div>
    <div class="cp-row"><span>IP</span><b>${cam.static_ip_address}</b></div>
    <div class="cp-row"><span>Zone · Floor</span><b>${cam.zone_id} · Floor ${cam.floor_number}</b></div>
    <div class="cp-row"><span>Azimuth / FOV</span><b>${cam.azimuth_angle ?? '—'}° / ${cam.field_of_view ?? '—'}°</b></div>
  </div>`;
}

// ── Count badge icon (zone clusters, floor clusters, grid clusters) ──
function buildCountIcon(color, count, label, size = 48) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:rgba(8,11,18,0.75);border:2px solid ${color};
      backdrop-filter:blur(10px);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      box-shadow:0 0 18px ${color}66;cursor:pointer;
      color:${color};font-family:'Outfit',sans-serif;
      animation:pin-pop 0.4s cubic-bezier(0.16,1,0.3,1) both;
    ">
      <span style="font-size:14px;font-weight:800;line-height:1">${count}</span>
      <span style="font-size:7px;opacity:0.7;letter-spacing:0.05em">${label}</span>
    </div>`,
    iconSize:   [size, size],
    iconAnchor: [size/2, size/2],
  });
}

// ── Scale guardrails: cluster within a floor when it holds this many cams ──
const DENSE_CAM_LIMIT = 20;   // above this, cams are grouped into ~18 m grid buckets
const GRID_CELL_DEG   = 0.00016; // ≈ 18 m cell size for dense-floor clustering

// ── GPS ↔ GIS geometry helpers ───────────────────────────────────────
const GPS_CONE_RANGE = 55;   // metres — matches the ~50 m FOA cone radius
const GPS_DRAW_RANGE = 250;  // metres — draw the bearing line only within this range
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const toRad = d => (d * Math.PI) / 180;
const toDeg = r => (r * 180) / Math.PI;

function haversineM(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function bearingDeg(aLat, aLng, bLat, bLng) {
  const y = Math.sin(toRad(bLng - aLng)) * Math.cos(toRad(bLat));
  const x = Math.cos(toRad(aLat)) * Math.sin(toRad(bLat))
          - Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLng - aLng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const cardinalOf = deg => CARDINALS[Math.round(deg / 45) % 8];

// Is the point (lat, lng) inside this camera's FOV cone?
function isInFov(cam, lat, lng) {
  if (haversineM(cam.latitude, cam.longitude, lat, lng) > GPS_CONE_RANGE) return false;
  const az  = cam.azimuth_angle ?? 0;
  const fov = cam.field_of_view ?? 60;
  const brg = bearingDeg(cam.latitude, cam.longitude, lat, lng); // camera → point
  return Math.abs(((brg - az + 540) % 360) - 180) <= fov / 2;
}

export default function GisMapCanvas({
  cameras, filteredCameras,
  selectedZone, selectedFloor, selectedCamera, flashCameraId,
  onFloorChange, onCameraSelect, onZoneSelect,
  loading, theme
}) {
  const mapRef      = useRef(null);
  const leafletRef  = useRef(null);
  const markersRef  = useRef([]);   // { cam?, marker }
  const polygonRef  = useRef([]);
  const expandedClustersRef = useRef(new Set());   // grid buckets the user opened
  const baseLayerRef = useRef(null);
  const [gpsTracking, setGpsTracking] = useState(false);
  const gpsMarkerRef = useRef(null);
  const gpsLineRef   = useRef(null);
  const [gpsFix,    setGpsFix]    = useState(null);     // { lat, lng, acc }
  const [gpsNearest, setGpsNearest] = useState(null);   // { cam, d, bearing, cardinal }
  const [gpsCover,  setGpsCover]  = useState([]);       // cameras whose FOV covers the fix
  const [gpsError,  setGpsError]  = useState(null);
  const camerasRef = useRef(cameras);
  camerasRef.current = cameras;
  const geoJsonRef = useRef(null);

  // ── Initialise Leaflet map ───────────────────────────────────────
  useEffect(() => {
    if (leafletRef.current) return;

    const map = L.map(mapRef.current, {
      center: [16.494381, 80.499227],
      zoom:   18,
      zoomControl: false,
      attributionControl: false,
    });

    L.control.zoom({ position: 'topleft' }).addTo(map);

    leafletRef.current = map;
    return () => { map.remove(); leafletRef.current = null; };
  }, []);

  // ── Handle Theme / Base Map Type ──────────────────────────────────────
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;

    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }

    // The Google Maps JS key in index.html is referer-restricted, so on origins
    // not allow-listed for it the mutant renders Google's "icon_error" tiles.
    // Default to OpenStreetMap (no key needed; styled dark by the CSS below) and
    // keep the Google imagery path behind an explicit opt-in. To enable it,
    // allow-list this origin for the key in Google Cloud Console and flip to true.
    const USE_GOOGLE_MAPS = false;

    if (USE_GOOGLE_MAPS) {
      // The plugin's ESM build only registers its factory on the global `L` and
      // never attaches the class, so L.gridLayer.googleMutant() throws. Construct
      // the exported class directly instead.
      baseLayerRef.current = new GoogleMutant({
        type: theme === 'light' ? 'roadmap' : 'hybrid'
      }).addTo(map);
    } else {
      baseLayerRef.current = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }
      ).addTo(map);
    }
  }, [theme]);

  // ── Fetch Official Campus Boundaries (GeoJSON) ───────────────────
  useEffect(() => {
    const map = leafletRef.current;
    if (!map || geoJsonRef.current) return;

    fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: '[out:json];way[building](16.490,80.495,16.499,80.505);(._;>;);out;'
    })
    .then(r => r.json())
    .then(data => {
      if (!data || !data.elements) throw new Error('Empty Overpass response');
      const geojson = osmtogeojson(data);
      try {
        geoJsonRef.current = L.geoJSON(geojson, {
          style: {
            color: '#3b82f6',
            weight: 2,
            opacity: 0.6,
            fillColor: '#3b82f6',
            fillOpacity: 0.05
          }
        }).addTo(map);
      } catch (e) {
        console.error('Adding building GeoJSON failed:', e);
      }
    })
    .catch(() => {/* Overpass is a best-effort external data source */});
  }, []);

  // ── Live GPS Tracking + GPS→GIS analysis ────────────────────────
  useEffect(() => {
    const map = leafletRef.current;

    const clearGps = () => {
      if (gpsMarkerRef.current) { gpsMarkerRef.current.remove(); gpsMarkerRef.current = null; }
      if (gpsLineRef.current)   { gpsLineRef.current.remove();   gpsLineRef.current = null; }
      setGpsFix(null);
      setGpsNearest(null);
      setGpsCover([]);
      setGpsError(null);
    };

    if (!gpsTracking || !map) { clearGps(); return; }
    if (!navigator.geolocation) { setGpsError('Geolocation is not supported by this browser'); return; }

    const onPosition = (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const latlng  = [latitude, longitude];
      const allCams = camerasRef.current || [];

      // ── Live GPS marker ──
      if (!gpsMarkerRef.current) {
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:16px;height:16px;background:#3b82f6;border-radius:50%;border:3px solid white;box-shadow:0 0 10px rgba(59,130,246,0.8);animation:pulse-glow 1.5s infinite"></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        });
        gpsMarkerRef.current = L.marker(latlng, { icon, zIndexOffset: 9999 }).addTo(map);
        map.flyTo(latlng, 19, { duration: 1.2 });
      } else {
        gpsMarkerRef.current.setLatLng(latlng);
      }

      // ── Nearest camera (any zone, whole campus) ──
      let nearest = null;
      let bestD = Infinity;
      for (const c of allCams) {
        const d = haversineM(latitude, longitude, c.latitude, c.longitude);
        if (d < bestD) { bestD = d; nearest = c; }
      }

      // ── Cameras whose FOV cone currently covers this position ──
      const cover = allCams
        .filter(c => isInFov(c, latitude, longitude))
        .sort((a, b) =>
          haversineM(latitude, longitude, a.latitude, a.longitude)
          - haversineM(latitude, longitude, b.latitude, b.longitude));

      setGpsFix({ lat: latitude, lng: longitude, acc: accuracy });
      setGpsCover(cover);

      if (nearest) {
        const b = bearingDeg(latitude, longitude, nearest.latitude, nearest.longitude);
        setGpsNearest({ cam: nearest, d: bestD, bearing: Math.round(b), cardinal: cardinalOf(b) });
      } else {
        setGpsNearest(null);
      }

      // ── Dashed bearing line to the nearest camera (only when close) ──
      if (gpsLineRef.current) { gpsLineRef.current.remove(); gpsLineRef.current = null; }
      if (nearest && bestD <= GPS_DRAW_RANGE) {
        gpsLineRef.current = L.polyline(
          [[latitude, longitude], [nearest.latitude, nearest.longitude]],
          { color: '#00d4ff', weight: 2, opacity: 0.85, dashArray: '6 8', interactive: false }
        ).addTo(map);
      }
    };

    const onError = (err) => {
      setGpsError(
        err && err.code === err.PERMISSION_DENIED
          ? 'Location permission denied — allow access to use GPS'
          : err && err.code === err.TIMEOUT
          ? 'GPS timed out — try again'
          : 'GPS signal unavailable'
      );
    };

    const watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000,
    });

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearGps();
    };
  }, [gpsTracking]);

  // ── Draw zone polygon footprints ─────────────────────────────────
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;

    polygonRef.current.forEach(p => p.remove());
    polygonRef.current = [];

    Object.entries(ZONE_POLYGONS).forEach(([zone, coords]) => {
      const color   = ZONE_COLOR[zone];
      const active  = selectedZone === zone;
      const dimmed  = selectedZone !== 'ALL' && !active;
      const poly = L.polygon(coords, {
        color,
        fillColor: color,
        fillOpacity: active ? 0.18 : dimmed ? 0.02 : 0.05,
        weight: active ? 2 : 1,
        opacity: active ? 0.9 : dimmed ? 0.12 : 0.3,
        dashArray: active ? null : '5 4',
        className: active ? 'zone-poly-active' : '',
      }).addTo(map);

      poly.on('click', () => onZoneSelect(zone));
      poly.bindTooltip(`<b>${zone}</b>`, { permanent: false, direction:'top', className:'tooltip-glass' });
      polygonRef.current.push(poly);
    });
  }, [selectedZone, onZoneSelect]);

  // ── Reset opened grid clusters whenever the view changes ──────────
  useEffect(() => {
    expandedClustersRef.current = new Set();
  }, [selectedZone, selectedFloor]);

  // ── Draw markers + FOA cones (zone / floor / camera-set changes only) ──
  useEffect(() => {
    const map = leafletRef.current;
    if (!map || cameras.length === 0) return;

    // Clear old markers & cones
    markersRef.current.forEach(m => m.marker.remove());
    markersRef.current = [];

    const showAllZones = selectedZone === 'ALL';
    const zoneColor    = ZONE_COLOR[selectedZone] ?? '#00d4ff';

    // ── Campus view: one cluster pin per zone ───────────────────────
    if (showAllZones && selectedFloor === null) {
      ['CB','FS','AB1','AB2','RP'].forEach(zone => {
        const zoneCams = cameras.filter(c => c.zone_id === zone);
        if (!zoneCams.length) return;
        const center  = ZONE_CENTER[zone];
        const online  = zoneCams.filter(c => c.current_status === 'Online').length;
        const offline = zoneCams.filter(c => c.current_status === 'Offline').length;
        const marker  = L.marker(center, { icon: buildCountIcon(ZONE_COLOR[zone], zoneCams.length, zone) }).addTo(map);
        marker.bindTooltip(
          `<b style="color:${ZONE_COLOR[zone]}">${ZONE_NAME[zone]}</b><br/>${zoneCams.length} cams · ${online} online · ${offline} offline`,
          { direction: 'top', offset: [0, -16], className: 'tooltip-glass' }
        );
        marker.on('click', () => {
          onZoneSelect(zone);
          map.flyTo(center, 19, { duration: 1.1 });
        });
        markersRef.current.push({ marker });
      });
      return;
    }

    // Helper: draw one camera as an individual pin (+ optional FOA cone)
    const addCameraPin = (cam, pos, delay) => {
      const isSelected = selectedCamera?.camera_id === cam.camera_id;
      const isFlash    = flashCameraId === cam.camera_id;
      const marker = L.marker(pos, { icon: buildPinIcon(cam.current_status, isSelected, isFlash, { delay }) })
        .addTo(map)
        .bindTooltip(
          `<b>${cam.camera_name}</b><br/>${cam.static_ip_address}<br/>Floor ${cam.floor_number}`,
          { direction: 'top', offset: [0, -16], className: 'tooltip-glass' }
        )
        .bindPopup(camPopupHtml(cam), { className: 'cam-popup', closeButton: false, offset: [0, -18] });

      marker.on('click', () => {
        onCameraSelect(cam);
        map.panTo(pos, { animate: true, duration: 0.4 });
      });

      markersRef.current.push({ cam, marker });
    };

    // ── Zone view: one cluster pin per floor (scales to 100s of cams) ──
    if (selectedZone !== 'ALL' && selectedFloor === null) {
      const byFloor = new Map();
      filteredCameras.forEach(c => {
        if (!byFloor.has(c.floor_number)) byFloor.set(c.floor_number, []);
        byFloor.get(c.floor_number).push(c);
      });

      byFloor.forEach((cams, floor) => {
        const count  = cams.length;
        const online = cams.filter(c => c.current_status === 'Online').length;
        // Every floor's camera centroid sits near the zone centre, so fan the
        // floor pins out on a golden-angle spiral to keep stacked floors apart.
        const clat = cams.reduce((s, c) => s + c.latitude, 0) / count;
        const clng = cams.reduce((s, c) => s + c.longitude, 0) / count;
        const angle  = floor * 2.39996;                        // ≈ 137.5° golden angle
        const radius = 0.000016 * (floor + 1);                 // ~2 m per floor step
        const lat = clat + Math.cos(angle) * radius;
        const lng = clng + Math.sin(angle) * radius;
        const marker = L.marker([lat, lng], { icon: buildCountIcon(zoneColor, count, `F${floor}`, 44) }).addTo(map);
        marker.bindTooltip(
          `<b style="color:${zoneColor}">Floor ${floor}</b><br/>${count} cams · ${online} online — click to expand`,
          { direction: 'top', offset: [0, -14], className: 'tooltip-glass' }
        );
        marker.on('click', () => {
          onFloorChange(floor);
          map.flyTo([lat, lng], 19, { duration: 0.9 });
        });
        markersRef.current.push({ marker });
      });
      return;
    }

    // ── Single floor view ───────────────────────────────────────────
    const dense = filteredCameras.length > DENSE_CAM_LIMIT;

    if (!dense) {
      // Few enough cameras — draw every pin (staggered pop-in from zone centre)
      filteredCameras.forEach(cam => {
        const distM = haversineM(cam.latitude, cam.longitude, ZONE_CENTER[selectedZone][0], ZONE_CENTER[selectedZone][1]);
        const delay = 120 + Math.min(700, Math.round(distM * 8));
        addCameraPin(cam, [cam.latitude, cam.longitude], delay);
      });
      return;
    }

    // Dense floor — group cameras into ~18 m grid buckets, one cluster per bucket.
    // Clicking a bucket replaces it with its member pins (spread out a few metres).
    const buckets = new Map();
    filteredCameras.forEach(c => {
      const key = `${Math.floor(c.latitude / GRID_CELL_DEG)},${Math.floor(c.longitude / GRID_CELL_DEG)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(c);
    });

    buckets.forEach((cams, key) => {
      if (cams.length === 1 || expandedClustersRef.current.has(key)) {
        cams.forEach((cam, i) => {
          const spread = i * 0.000008;
          const pos = [cam.latitude + spread * Math.cos(i * 2.4), cam.longitude + spread * Math.sin(i * 2.4)];
          addCameraPin(cam, pos, 120 + i * 30);
        });
        return;
      }

      const count = cams.length;
      const lat = cams.reduce((s, c) => s + c.latitude, 0) / count;
      const lng = cams.reduce((s, c) => s + c.longitude, 0) / count;
      const marker = L.marker([lat, lng], { icon: buildCountIcon(zoneColor, count, `F${selectedFloor}`, 40) }).addTo(map);
      marker.bindTooltip(
        `<b>${count} cameras</b><br/>Floor ${selectedFloor} — click to expand`,
        { direction: 'top', offset: [0, -14], className: 'tooltip-glass' }
      );
      marker.on('click', () => {
        expandedClustersRef.current.add(key);
        marker.remove();
        cams.forEach((cam, i) => {
          const spread = i * 0.000008;
          const pos = [cam.latitude + spread * Math.cos(i * 2.4), cam.longitude + spread * Math.sin(i * 2.4)];
          addCameraPin(cam, pos, 60 + i * 35);
        });
      });
      markersRef.current.push({ marker });
    });
  }, [cameras, filteredCameras, selectedZone, selectedFloor, onCameraSelect, onZoneSelect, onFloorChange]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Smoothly refresh pin visuals on selection / flash without rebuilding ──
  useEffect(() => {
    const clusterMode = selectedZone === 'ALL' && selectedFloor === null;
    if (clusterMode) return;
    markersRef.current.forEach(entry => {
      if (!entry.cam) return;
      const isSelected = selectedCamera?.camera_id === entry.cam.camera_id;
      const isFlash    = flashCameraId === entry.cam.camera_id;
      entry.marker.setIcon(buildPinIcon(entry.cam.current_status, isSelected, isFlash, { animate: false }));
    });
  }, [selectedCamera, flashCameraId, selectedZone, selectedFloor]);

  // ── Smooth zone fly-to (skip when a camera flight is already pending) ──
  useEffect(() => {
    const map = leafletRef.current;
    if (!map || flashCameraId) return;
    if (selectedZone === 'ALL') {
      map.flyTo([16.494381, 80.499227], 18, { duration: 0.9 });
      return;
    }
    map.flyTo(ZONE_CENTER[selectedZone], 19, { duration: 0.8 });
  }, [selectedZone]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Smooth floor fly-to ─────────────────────────────────────────
  useEffect(() => {
    const map = leafletRef.current;
    if (!map || selectedZone === 'ALL' || flashCameraId) return;
    const zoom = selectedFloor === null ? 18 : 19;
    map.flyTo(ZONE_CENTER[selectedZone], zoom, { duration: 0.6 });
  }, [selectedFloor]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Flash: fly to selected camera ────────────────────────────────
  useEffect(() => {
    if (!flashCameraId || !leafletRef.current) return;
    const cam = cameras.find(c => c.camera_id === flashCameraId);
    if (cam) leafletRef.current.flyTo([cam.latitude, cam.longitude], 20, { duration: 0.8 });
  }, [flashCameraId, cameras]);

  // ── Per-floor status summary for the floor switcher ────────────────
  const floorData = useMemo(() => {
    if (selectedZone === 'ALL') return [];
    const max = FLOOR_MAX[selectedZone] ?? 4;
    const out = [];
    for (let f = max; f >= 0; f--) {
      const list = cameras.filter(c => c.zone_id === selectedZone && c.floor_number === f);
      out.push({
        floor: f,
        total: list.length,
        online:    list.filter(c => c.current_status === 'Online').length,
        offline:   list.filter(c => c.current_status === 'Offline').length,
        degraded:  list.filter(c => c.current_status === 'Degraded').length,
      });
    }
    return out;
  }, [cameras, selectedZone]);

  const zoneTotal = floorData.reduce((s, d) => s + d.total, 0);
  const zoneOnline = floorData.reduce((s, d) => s + d.online, 0);
  const currentFloorStat = floorData.find(d => d.floor === selectedFloor);
  const metaTotal  = selectedFloor !== null && currentFloorStat ? currentFloorStat.total  : zoneTotal;
  const metaOnline = selectedFloor !== null && currentFloorStat ? currentFloorStat.online : zoneOnline;

  return (
    <div className="map-panel">
      {/* Leaflet map container */}
      <div ref={mapRef} style={{ height: '100%', width: '100%' }} />

      {loading && (
        <div style={{
          position:'absolute', inset:0, display:'flex', alignItems:'center',
          justifyContent:'center', background:'rgba(8,11,18,0.85)', zIndex:900,
          flexDirection:'column', gap:12, color:'var(--text-secondary)',
          fontFamily:'var(--font-ui)', fontSize:13,
        }}>
          <span className="spinner" style={{ width:28, height:28, borderWidth:3 }} />
          Loading campus grid…
        </div>
      )}

      {/* Location breadcrumb (animated on change) */}
      {selectedZone !== 'ALL' && (
        <div className="floor-breadcrumb" key={`${selectedZone}-${selectedFloor ?? 'A'}`}>
          <button
            className="fb-back"
            onClick={() => onZoneSelect('ALL')}
            title="Back to all zones"
            aria-label="Back to all zones"
          >←</button>
          <span className="fb-zone" style={{ color: ZONE_COLOR[selectedZone] }}>{selectedZone}</span>
          <span className="fb-name">{ZONE_NAME[selectedZone]}</span>
          <span className="fb-divider">/</span>
          <span className={`fb-floor ${selectedFloor === null ? 'all' : ''}`}>
            {selectedFloor !== null ? `Floor ${selectedFloor}` : 'All Floors'}
          </span>
          <span className="fb-meta">
            {metaTotal} cams · {metaOnline} online
          </span>
        </div>
      )}

      {/* Vertical Floor Selector */}
      {selectedZone !== 'ALL' && (
        <div className="floor-slider-panel">
          <div className="floor-slider-label">FLOOR</div>

          <button
            className={`floor-all-btn ${selectedFloor === null ? 'active' : ''}`}
            onClick={() => onFloorChange(null)}
            title={`All floors — ${zoneTotal} cameras, ${zoneOnline} online`}
          >ALL</button>

          {floorData.map((d, i) => {
            const active = selectedFloor === d.floor;
            const pct = d.total ? {
              on:  (d.online  / d.total) * 100,
              deg: (d.degraded / d.total) * 100,
              off: (d.offline / d.total) * 100,
            } : null;
            return (
              <React.Fragment key={d.floor}>
                {i > 0 && <div className="floor-divider" />}
                <button
                  id={`floor-btn-${d.floor}`}
                  className={`floor-btn ${active ? 'active' : ''}`}
                  onClick={() => onFloorChange(selectedFloor === d.floor ? null : d.floor)}
                  title={`Floor ${d.floor} — ${d.online} online · ${d.degraded} degraded · ${d.offline} offline`}
                >
                  <span className="floor-btn-num">{d.floor}</span>
                  {d.total > 0 && pct && (
                    <span className="floor-btn-bar">
                      {pct.on  > 0 && <i style={{ width: `${pct.on}%`,  background: 'var(--status-online)'  }} />}
                      {pct.deg > 0 && <i style={{ width: `${pct.deg}%`, background: 'var(--status-degraded)' }} />}
                      {pct.off > 0 && <i style={{ width: `${pct.off}%`, background: 'var(--status-offline)'  }} />}
                    </span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Map bottom controls */}
      <div className="map-controls">
        <button className="map-ctrl-btn" onClick={() => leafletRef.current?.setView([16.494381, 80.499227], 18)}>
          <Layers size={13} />
          Reset View
        </button>
        <button className={`map-ctrl-btn ${gpsTracking ? 'active' : ''}`} onClick={() => setGpsTracking(!gpsTracking)}>
          <Navigation size={13} />
          {gpsTracking ? 'Tracking GPS' : 'Locate Me'}
        </button>
      </div>

      {/* GPS ↔ GIS HUD */}
      {gpsTracking && (
        <div className="gps-hud">
          {gpsError && (
            <div className="gps-hud-title gps-hud-error">
              <span className="gps-dot danger" />
              {gpsError}
            </div>
          )}

          {!gpsFix && !gpsError && (
            <div className="gps-hud-title">
              <span className="spinner" style={{ width: 10, height: 10 }} />
              Acquiring GPS signal…
            </div>
          )}

          {gpsFix && (
            <>
              <div className="gps-hud-title">
                <span className="gps-dot" />
                GPS Locked · ±{Math.round(gpsFix.acc)} m
              </div>

              {gpsNearest && (
                <div className="gps-hud-card">
                  <div className="gps-label">NEAREST CAMERA</div>
                  <div className="gps-cam-name">{gpsNearest.cam.camera_name}</div>
                  <div className="gps-row">
                    <span className="gps-sub">{gpsNearest.cam.zone_id} · FL{gpsNearest.cam.floor_number}</span>
                    <span className="gps-sub mono">
                      <span className="gps-arrow" style={{ transform: `rotate(${gpsNearest.bearing}deg)` }}>↑</span>
                      {gpsNearest.d < 1000 ? `${gpsNearest.d.toFixed(0)} m` : `${(gpsNearest.d / 1000).toFixed(2)} km`} {gpsNearest.cardinal}
                    </span>
                  </div>
                </div>
              )}

              <div className="gps-row">
                <span className="gps-sub">Cameras covering you</span>
                <span className="gps-sub mono">{gpsCover.length}</span>
              </div>
              {gpsCover.length > 0 && (
                <div className="gps-cover-list">
                  {gpsCover.slice(0, 4).map(c => (
                    <span key={c.camera_id} className={`gps-cover-chip ${(c.current_status || '').toLowerCase()}`}>
                      {c.camera_name}
                    </span>
                  ))}
                  {gpsCover.length > 4 && <span className="gps-cover-more">+{gpsCover.length - 4} more</span>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
