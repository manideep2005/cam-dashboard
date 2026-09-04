import React, { useState, useEffect, useRef } from 'react';
import { Camera, X } from 'lucide-react';

const ZONES    = ['CB','FS','AB1','AB2','RP'];
const STATUSES = ['Online','Offline','Degraded'];

// Subnet prefix per zone (CB floor-aware) — sync, for the placeholder
function subnetPrefix(zone, floor) {
  if (zone === 'CB') return `192.168.1${floor ?? 0}.`;
  if (zone === 'FS')  return '192.168.20.';
  if (zone === 'AB1') return '192.168.30.';
  if (zone === 'AB2') return '192.168.40.';
  if (zone === 'RP')  return '192.168.50.';
  return '';
}

// First FREE host in the zone's subnet (asks the API so IPs never collide)
async function suggestFreeIp(zone, floor) {
  const prefix = subnetPrefix(zone, floor);
  try {
    const res  = await fetch(`/api/cameras?zone=${zone}`);
    const cams = await res.json();
    const used = new Set((cams || []).map(c => c.static_ip_address));
    let host = 10;
    while (used.has(`${prefix}${host}`)) host++;
    return `${prefix}${host}`;
  } catch {
    return `${prefix}10`;
  }
}

const FLOOR_MAX = { CB:8, FS:4, AB1:4, AB2:4, RP:4 };

export default function AddEditCameraModal({ camera, onClose, onSave }) {
  const isEdit = !!camera;

  const [form, setForm] = useState({
    camera_name:       camera?.camera_name       ?? '',
    zone_id:           camera?.zone_id           ?? 'CB',
    floor_number:      camera?.floor_number      ?? 0,
    static_ip_address: camera?.static_ip_address ?? '',
    mac_address:       camera?.mac_address       ?? '',
    rtsp_stream_url:   camera?.rtsp_stream_url   ?? '',
    latitude:          camera?.latitude          ?? 16.494381,
    longitude:         camera?.longitude         ?? 80.499227,
    azimuth_angle:     camera?.azimuth_angle     ?? 0,
    field_of_view:     camera?.field_of_view     ?? 60,
    current_status:    camera?.current_status    ?? 'Online',
  });

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const lastAutoIpRef = useRef('');   // last IP we auto-suggested (untouched guard)

  // Auto-fill RTSP when IP changes
  useEffect(() => {
    if (form.static_ip_address && !isEdit) {
      setForm(f => ({ ...f, rtsp_stream_url: `rtsp://${form.static_ip_address}:554/live/stream1` }));
    }
  }, [form.static_ip_address, isEdit]);

  // Auto-fill a COMPLETE free IP when the modal opens or zone/floor changes —
  // but only if the user hasn't typed their own IP yet
  useEffect(() => {
    if (isEdit) return;
    const untouched = !form.static_ip_address || form.static_ip_address === lastAutoIpRef.current;
    if (!untouched) return;
    let alive = true;
    suggestFreeIp(form.zone_id, form.floor_number).then(ip => {
      if (!alive) return;
      lastAutoIpRef.current = ip;
      setForm(f => ({ ...f, static_ip_address: ip }));
    });
    return () => { alive = false; };
  }, [form.zone_id, form.floor_number, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const floorMax  = FLOOR_MAX[form.zone_id] ?? 4;
  const floorOpts = Array.from({ length: floorMax + 1 }, (_, i) => i);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    // Client-side duplicate IP check — instant feedback instead of the raw DB error
    const ip = (form.static_ip_address || '').trim();
    if (ip) {
      try {
        const res  = await fetch(`/api/cameras?zone=${form.zone_id}`);
        const cams = await res.json();
        const clash = (cams || []).find(c =>
          c.static_ip_address === ip && (!isEdit || c.camera_id !== camera.camera_id));
        if (clash) {
          setError(`IP address ${ip} is already used by ${clash.camera_name} — please choose a different one.`);
          setSaving(false);
          return;
        }
      } catch { /* server stays the backstop */ }
    }

    try {
      const url    = isEdit ? `/api/cameras/${camera.camera_id}` : '/api/cameras';
      const method = isEdit ? 'PUT' : 'POST';
      const res    = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...form, static_ip_address: ip, floor_number: Number(form.floor_number), azimuth_angle: Number(form.azimuth_angle), field_of_view: Number(form.field_of_view), latitude: Number(form.latitude), longitude: Number(form.longitude) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Save failed');
      }
      await onSave();
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">
          <Camera size={18} style={{ color:'var(--accent-cyan)' }} />
          {isEdit ? 'Edit Camera Asset' : 'Add New Camera'}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-grid">
            {/* Name */}
            <div className="modal-field full">
              <label className="modal-label">Camera Name</label>
              <input
                className="modal-input"
                value={form.camera_name}
                onChange={e => set('camera_name', e.target.value)}
                placeholder="e.g. CB-FL3-Corridor-East"
                required
              />
            </div>

            {/* Zone */}
            <div className="modal-field">
              <label className="modal-label">Zone</label>
              <select className="modal-select" value={form.zone_id} onChange={e => set('zone_id', e.target.value)}>
                {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>

            {/* Floor */}
            <div className="modal-field">
              <label className="modal-label">Floor Number</label>
              <select className="modal-select" value={form.floor_number} onChange={e => set('floor_number', Number(e.target.value))}>
                {floorOpts.map(f => <option key={f} value={f}>Floor {f}</option>)}
              </select>
            </div>

            {/* IP */}
            <div className="modal-field">
              <label className="modal-label">Static IP Address</label>
              <input
                className="modal-input"
                value={form.static_ip_address}
                onChange={e => set('static_ip_address', e.target.value)}
                placeholder={subnetPrefix(form.zone_id, form.floor_number) + 'X'}
                required
              />
            </div>

            {/* MAC */}
            <div className="modal-field">
              <label className="modal-label">MAC Address</label>
              <input
                className="modal-input"
                value={form.mac_address}
                onChange={e => set('mac_address', e.target.value)}
                placeholder="aa:bb:cc:dd:ee:ff"
                required
              />
            </div>

            {/* RTSP */}
            <div className="modal-field full">
              <label className="modal-label">RTSP Stream URL</label>
              <input
                className="modal-input"
                value={form.rtsp_stream_url}
                onChange={e => set('rtsp_stream_url', e.target.value)}
                placeholder="rtsp://192.168.x.x:554/live/stream1"
                required
              />
            </div>

            {/* Lat / Lng */}
            <div className="modal-field">
              <label className="modal-label">Latitude</label>
              <input className="modal-input" type="number" step="any" value={form.latitude} onChange={e => set('latitude', e.target.value)} required />
            </div>
            <div className="modal-field">
              <label className="modal-label">Longitude</label>
              <input className="modal-input" type="number" step="any" value={form.longitude} onChange={e => set('longitude', e.target.value)} required />
            </div>

            {/* Azimuth / FOV */}
            <div className="modal-field">
              <label className="modal-label">Azimuth Angle (0-360°)</label>
              <input className="modal-input" type="number" min="0" max="360" value={form.azimuth_angle} onChange={e => set('azimuth_angle', e.target.value)} />
            </div>
            <div className="modal-field">
              <label className="modal-label">Field of View (°)</label>
              <input className="modal-input" type="number" min="1" max="360" value={form.field_of_view} onChange={e => set('field_of_view', e.target.value)} />
            </div>

            {/* Status */}
            <div className="modal-field full">
              <label className="modal-label">Current Status</label>
              <select className="modal-select" value={form.current_status} onChange={e => set('current_status', e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {error && (
            <div style={{ color:'var(--status-offline)', fontSize:12, marginBottom:12, padding:'8px 12px', background:'rgba(239,68,68,0.08)', borderRadius:'var(--radius-sm)', border:'1px solid rgba(239,68,68,0.2)' }}>
              ⚠ {error}
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Camera'}
            </button>
          </div>
        </form>

        <button onClick={onClose} style={{ position:'absolute', top:16, right:16, background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer' }}>
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
