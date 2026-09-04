import React, { useMemo, useState } from 'react';
import { ArrowLeft, Building2, Camera, ClipboardList, Copy, MapPin, Search, X } from 'lucide-react';

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

function floorLabel(f) {
  if (f === 0) return 'Ground Floor';
  if (f === 1) return '1st Floor';
  const suffix = f % 10 === 2 ? 'nd' : f % 10 === 3 ? 'rd' : 'th';
  return `${f}${suffix} Floor`;
}

export default function CameraDashboard({ cameras, stats, onSelectCamera, onClose }) {
  const [zone, setZone] = useState(null);        // null → zone grid; 'ALL' or code → drill-in
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

  // Per-zone summary for the landing cards
  const zoneInfo = useMemo(() => {
    const m = {};
    for (const z of ZONES) {
      if (z === 'ALL') continue;
      const cams = cameras.filter(c => c.zone_id === z);
      const floors = [...new Set(cams.map(c => c.floor_number))].sort((a, b) => a - b);
      m[z] = {
        count: cams.length,
        online: cams.filter(c => c.current_status === 'Online').length,
        floors,
      };
    }
    return m;
  }, [cameras]);

  const filtered = useMemo(() => cameras.filter(c => {
    if (zone !== null && zone !== 'ALL' && c.zone_id !== zone) return false;
    if (status !== 'ALL' && c.current_status !== status) return false;
    if (q.trim()) {
      const hay = `${c.camera_name} ${c.static_ip_address} ${c.mac_address} ${c.zone_id} ${ZONE_LABELS[c.zone_id] || ''} ${areaOf(c)}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  }), [cameras, zone, status, q]);

  // Drill-in content: grouped by floor (and by zone when viewing ALL)
  const groups = useMemo(() => {
    if (zone === null) return [];
    const byFloor = (cams) => {
      const map = new Map();
      cams.forEach(c => {
        const f = c.floor_number ?? 0;
        if (!map.has(f)) map.set(f, []);
        map.get(f).push(c);
      });
      return [...map.entries()].sort((a, b) => a[0] - b[0])
        .map(([floor, list]) => ({ floor, list }));
    };
    if (zone === 'ALL') {
      return ZONES.filter(z => z !== 'ALL').map(z => {
        const cams = filtered.filter(c => c.zone_id === z);
        return cams.length
          ? { zone: z, label: ZONE_LABELS[z], color: ZONE_COLOR[z], groups: byFloor(cams) }
          : null;
      }).filter(Boolean);
    }
    return [{ zone, label: ZONE_LABELS[zone], color: ZONE_COLOR[zone], groups: byFloor(filtered) }];
  }, [zone, filtered]);

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

  const cameraTile = (cam, i) => {
    const area = areaOf(cam);
    const badgeCls = (cam.current_status || '').toLowerCase();
    const statusColor =
      cam.current_status === 'Online' ? 'var(--status-online)' :
      cam.current_status === 'Offline' ? 'var(--status-offline)' : 'var(--status-degraded)';
    return (
      <div
        key={cam.camera_id}
        className="dash-cam-card"
        style={{ animationDelay: `${Math.min(i, 24) * 20}ms` }}
        onClick={() => onSelectCamera(cam)}
        title="Locate this camera on the map"
      >
        <div className="dash-cam-card-head">
          <span className="dash-cam-dot" style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
          <span className="dash-cam-card-name">{cam.camera_name}</span>
          <span className={`status-badge ${badgeCls}`}>{cam.current_status}</span>
        </div>
        <div className="dash-cam-card-area">{area || '—'}</div>
        <div className="dash-cam-card-foot">
          <span className={`zone-badge ${cam.zone_id}`}>{cam.zone_id}</span>
          <span className="dash-floor-chip">F{cam.floor_number}</span>
          <span className="dash-cam-locate"><MapPin size={11} /> Locate</span>
          <button
            className="dash-copy-cell"
            onClick={e => { e.stopPropagation(); copyField(cam, 'static_ip_address'); }}
            title="Copy IP address"
          >
            <span className="mono">{cam.static_ip_address}</span>
            {copied === `${cam.camera_id}:static_ip_address` ? <span className="dash-copied">✓</span> : <Copy size={10} />}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="dash-shell">
      {/* ── Heading + stats ── */}
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

        {/* ── Drill-in breadcrumb / landing label ── */}
        {zone === null ? (
          <div className="dash-section-label">Zones — select one to load its cameras</div>
        ) : (
          <div className="dash-drill-head">
            <button className="dash-back" onClick={() => setZone(null)}><ArrowLeft size={13} /> All zones</button>
            <div
              className="dash-drill-title"
              style={{ color: zone === 'ALL' ? 'var(--text-primary)' : ZONE_COLOR[zone] }}
            >
              {zone === 'ALL' ? 'All Cameras' : `${zone} · ${ZONE_LABELS[zone]}`}
            </div>
            <span className="dash-count-hint">Showing <b>{filtered.length}</b> of {cameras.length} cameras</span>
          </div>
        )}

        {/* ── Toolbar (drill-in only) ── */}
        {zone !== null && (
          <div className="dash-toolbar">
            <div className="dash-search-wrap">
              <Search size={12} className="dash-search-icon" />
              <input
                className="dash-search"
                placeholder="Search name · IP · MAC · area…"
                value={q}
                onChange={e => setQ(e.target.value)}
              />
            </div>
            <select className="dash-select" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="ALL">All statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="dash-body">
        {zone === null ? (
          <>
            <div className="dash-zone-grid">
              <button
                className="dash-zone-card all"
                style={{ '--zc': 'var(--text-secondary)' }}
                onClick={() => setZone('ALL')}
              >
                <div className="dash-zone-card-top">
                  <span className="dash-zone-card-code">ALL</span>
                  <span className="dash-zone-card-count">{counts.total}</span>
                </div>
                <div className="dash-zone-card-name">All Cameras</div>
                <div className="dash-zone-card-bar"><div className="dash-zone-card-bar-fill" style={{ width: '100%', background: 'var(--text-secondary)' }} /></div>
                <div className="dash-zone-card-meta">campus-wide inventory</div>
              </button>
              {ZONES.filter(z => z !== 'ALL').map((z, i) => {
                const info = zoneInfo[z];
                const pct = info.count ? Math.round((info.online / info.count) * 100) : 0;
                return (
                  <button
                    key={z}
                    className="dash-zone-card"
                    style={{ '--zc': ZONE_COLOR[z], animationDelay: `${i * 25}ms` }}
                    onClick={() => setZone(z)}
                  >
                    <div className="dash-zone-card-top">
                      <span className="dash-zone-card-code">{z}</span>
                      <span className="dash-zone-card-count">{info.count}</span>
                    </div>
                    <div className="dash-zone-card-name">{ZONE_LABELS[z]}</div>
                    <div className="dash-zone-card-bar">
                      <div className="dash-zone-card-bar-fill" style={{ width: `${pct}%`, background: ZONE_COLOR[z] }} />
                    </div>
                    <div className="dash-zone-card-meta">{info.online} online · {info.floors.length} floors</div>
                  </button>
                );
              })}
            </div>
            <div className="dash-landing-hint">
              <Building2 size={30} />
              <p>Each card loads that zone's cameras — grouped by floor.</p>
            </div>
          </>
        ) : filtered.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 60 }}>
            <Camera size={34} />
            <p>No cameras match the current filters.</p>
          </div>
        ) : (
          groups.map(grp => (
            <section key={grp.zone} className="dash-zone-group">
              <div className="dash-zone-group-head">
                <span className={`zone-badge ${grp.zone}`}>{grp.zone}</span>
                <span className="dash-zone-group-name" style={{ color: grp.color }}>{grp.label}</span>
                <span className="dash-zone-group-count">
                  {grp.groups.reduce((n, g) => n + g.list.length, 0)} cameras
                </span>
              </div>
              {grp.groups.map(({ floor, list }) => (
                <div key={floor} className="dash-floor-group">
                  <div className="dash-floor-head">
                    <span className="dash-floor-chip">F{floor}</span>
                    <span className="dash-floor-name">{floorLabel(floor)}</span>
                    <span className="dash-floor-count">{list.length} cam{list.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="dash-cam-grid">
                    {list.map((cam, i) => cameraTile(cam, i))}
                  </div>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}