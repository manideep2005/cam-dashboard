import React, { useMemo, useState } from 'react';
import { Camera, ClipboardList, Copy, MapPin, Search, X } from 'lucide-react';

const ZONES = ['ALL', 'CB', 'FS', 'AB1', 'AB2', 'RP'];
const ZONE_LABELS = {
  CB:  'Central Block',
  FS:  'Food Street',
  AB1: 'Academic Block 1',
  AB2: 'Academic Block 2',
  RP:  'Rock Plaza',
};
const ZONE_COLOR = { CB: '#3b82f6', FS: '#f59e0b', AB1: '#10b981', AB2: '#8b5cf6', RP: '#ec4899' };
const STATUSES = ['Online', 'Offline', 'Degraded'];

// ── Human-readable area from a camera name ──────────────────────────
// "CB-FL3-Corridor-North" → "Corridor North", "FS-FL0-FoodCourt-Main" → "Food Court Main"
function areaOf(cam) {
  const parts = String(cam.camera_name || '').split(/[-_]/);
  if (ZONES.slice(1).includes(parts[0]?.toUpperCase())) parts.shift();
  if (parts.length && /^FL?\d+$/i.test(parts[0])) parts.shift();
  if (parts.length && /^\d+$/.test(parts[0])) parts.shift(); // e.g. "CB 3 Corridor"
  const joined = parts.join(' ').trim();
  if (!joined) return '';
  return joined.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\bCam\b/gi, '').trim();
}

export default function CameraDashboard({ cameras, stats, onSelectCamera, onClose }) {
  const [zone, setZone] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState(null);

  const counts = useMemo(() => {
    const c = { total: cameras.length, online: 0, offline: 0, degraded: 0 };
    cameras.forEach(x => {
      if (x.current_status === 'Online') c.online++;
      else if (x.current_status === 'Offline') c.offline++;
      else c.degraded++;
    });
    return c;
  }, [cameras]);

  const zoneCounts = useMemo(() => {
    const m = {};
    for (const z of ZONES) if (z !== 'ALL') m[z] = cameras.filter(c => c.zone_id === z).length;
    return m;
  }, [cameras]);

  const filtered = useMemo(() => cameras.filter(c => {
    if (zone !== 'ALL' && c.zone_id !== zone) return false;
    if (status !== 'ALL' && c.current_status !== status) return false;
    if (q.trim()) {
      const hay = `${c.camera_name} ${c.static_ip_address} ${c.mac_address} ${c.zone_id} ${ZONE_LABELS[c.zone_id] || ''} ${areaOf(c)}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  }), [cameras, zone, status, q]);

  const copyField = async (cam, field) => {
    try {
      await navigator.clipboard.writeText(String(cam[field] ?? ''));
      setCopied(`${cam.camera_id}:${field}`);
      setTimeout(() => setCopied(null), 1200);
    } catch { /* clipboard unavailable */ }
  };

  const statChip = (label, value, cls) => (
    <div className={`dash-stat ${cls || ''}`}>
      <span className="dash-stat-value">{value ?? '—'}</span>
      <span className="dash-stat-label">{label}</span>
    </div>
  );

  return (
    <div className="dash-shell">
      {/* ── Heading ── */}
      <div className="dash-top">
        <div className="dash-heading">
          <span className="dash-heading-icon"><ClipboardList size={16} /></span>
          <div className="dash-heading-text">
            <div className="dash-title">Camera Asset Dashboard</div>
            <div className="dash-subtitle">
              {cameras.length} surveillance nodes · campus-wide inventory · updated {stats?.timestamp ? new Date(stats.timestamp).toLocaleTimeString() : '…'}
            </div>
          </div>
          <button className="dash-close" onClick={onClose} title="Back to GIS map"><X size={16} /></button>
        </div>

        {/* ── Pulse stats ── */}
        <div className="dash-stats">
          {statChip('Total', counts.total, '')}
          {statChip('Online', counts.online, 'online')}
          {statChip('Offline', counts.offline, 'offline')}
          {statChip('Degraded', counts.degraded, 'degraded')}
          <div className="dash-stat nvr">
            <span className="dash-stat-value">{stats?.uptime_pct ?? '—'}%</span>
            <span className="dash-stat-label">Uptime</span>
          </div>
        </div>

        {/* ── Zone chips ── */}
        <div className="dash-zones">
          {ZONES.map(z => {
            const color = z === 'ALL' ? 'var(--text-secondary)' : ZONE_COLOR[z];
            const active = zone === z;
            return (
              <button
                key={z}
                className={`dash-zone-chip ${active ? 'active' : ''}`}
                style={z === 'ALL' ? undefined : {
                  color: active ? '#000' : color,
                  borderColor: active ? color : `${color}55`,
                  background: active ? color : `${color}14`,
                }}
                onClick={() => setZone(z)}
              >
                {z === 'ALL' ? 'All Zones' : ZONE_LABELS[z]}
                <span className="dash-zone-count">{z === 'ALL' ? counts.total : zoneCounts[z] ?? 0}</span>
              </button>
            );
          })}
        </div>

        {/* ── Toolbar ── */}
        <div className="dash-toolbar">
          <div className="dash-search-wrap">
            <Search size={12} className="dash-search-icon" />
            <input
              className="dash-search"
              placeholder="Search name · IP · MAC · zone · area…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>
          <select className="dash-select" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="ALL">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="dash-count-hint">
            Showing <b>{filtered.length}</b> of {cameras.length} cameras
          </span>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="dash-table-wrap">
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 60 }}>
            <Camera size={34} />
            <p>No cameras match the current filters.</p>
          </div>
        ) : (
          <table className="dash-table">
            <thead>
              <tr>
                <th>Camera</th>
                <th>Where</th>
                <th>Status</th>
                <th>Network</th>
                <th>Stream (RTSP)</th>
                <th>Geometry</th>
                <th className="dash-th-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(cam => {
                const area = areaOf(cam);
                const badgeCls = (cam.current_status || '').toLowerCase();
                const statusColor =
                  cam.current_status === 'Online' ? 'var(--status-online)' :
                  cam.current_status === 'Offline' ? 'var(--status-offline)' : 'var(--status-degraded)';
                const locSub = [area && area !== ' ' ? area : null, ZONE_LABELS[cam.zone_id], cam.floor_number !== null && cam.floor_number !== undefined ? `Floor ${cam.floor_number}` : null]
                  .filter(Boolean).join(' · ');
                return (
                  <tr key={cam.camera_id} onClick={() => onSelectCamera(cam)} title="Locate this camera on the map">
                    <td>
                      <div className="dash-cam-name">
                        <span className="dash-cam-dot" style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
                        {cam.camera_name}
                      </div>
                      <div className="dash-sub mono">CAM-{String(cam.camera_id).padStart(4, '0')}</div>
                    </td>
                    <td>
                      <div className="dash-sub">
                        <span className={`zone-badge ${cam.zone_id}`}>{cam.zone_id}</span>
                        <span style={{ marginLeft: 5 }}>{locSub}</span>
                      </div>
                      <div className="dash-sub muted">Az {cam.azimuth_angle ?? '—'}° aimed · cone covers ~{(cam.field_of_view ?? 60)}° FOV</div>
                    </td>
                    <td><span className={`status-badge ${badgeCls}`}>{cam.current_status}</span></td>
                    <td>
                      <button className="dash-copy-cell" onClick={e => { e.stopPropagation(); copyField(cam, 'static_ip_address'); }}>
                        <span className="mono">{cam.static_ip_address}</span>
                        {copied === `${cam.camera_id}:static_ip_address` ? <span className="dash-copied">✓</span> : <Copy size={10} />}
                      </button>
                      <div className="dash-sub mono muted">{cam.mac_address}</div>
                    </td>
                    <td>
                      <button className="dash-copy-cell rtsp" onClick={e => { e.stopPropagation(); copyField(cam, 'rtsp_stream_url'); }} title="Click to copy">
                        <span className="mono">{cam.rtsp_stream_url}</span>
                        {copied === `${cam.camera_id}:rtsp_stream_url` ? <span className="dash-copied">✓</span> : <Copy size={10} />}
                      </button>
                    </td>
                    <td>
                      <div className="dash-sub mono">AZ {cam.azimuth_angle ?? '—'}° · FOV {cam.field_of_view ?? 60}°</div>
                      <div className="dash-sub mono muted">{Number(cam.latitude).toFixed(5)}, {Number(cam.longitude).toFixed(5)}</div>
                    </td>
                    <td>
                      <button
                        className="dash-locate"
                        onClick={e => { e.stopPropagation(); onSelectCamera(cam); }}
                        title="Locate on map"
                      >
                        <MapPin size={13} /> Locate
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
