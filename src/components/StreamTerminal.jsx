import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Camera, Copy, Maximize2, RefreshCw, ZoomIn, ZoomOut,
  RotateCcw, Download, AlertTriangle, WifiOff, Edit, Plus,
} from 'lucide-react';
import AddEditCameraModal from './AddEditCameraModal.jsx';

// ─── Simulated live-stream canvas renderer ───────────────────────────
function useLiveStream(canvasRef, camera) {
  const animRef   = useRef(null);
  const frameRef  = useRef(0);
  const noiseRef  = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx    = canvas.getContext('2d');
    const W      = canvas.width  = canvas.offsetWidth  * window.devicePixelRatio;
    const H      = canvas.height = canvas.offsetHeight * window.devicePixelRatio;

    // Build persistent noise texture
    if (!noiseRef.current || noiseRef.current.width !== W) {
      const nCanvas = document.createElement('canvas');
      nCanvas.width = W; nCanvas.height = H;
      const nCtx = nCanvas.getContext('2d');
      const nImg  = nCtx.createImageData(W, H);
      for (let i = 0; i < nImg.data.length; i += 4) {
        const v = Math.random() * 40;
        nImg.data[i] = nImg.data[i+1] = nImg.data[i+2] = v;
        nImg.data[i+3] = 255;
      }
      nCtx.putImageData(nImg, 0, 0);
      noiseRef.current = nCanvas;
    }

    function drawOffline() {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, W, H);
      // static noise
      ctx.globalAlpha = 0.06;
      ctx.drawImage(noiseRef.current, 0, 0);
      ctx.globalAlpha = 1;
      // scan lines
      for (let y = 0; y < H; y += 4) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, y, W, 1);
      }
    }

    function drawDegraded(t) {
      // Dark blueish tint
      ctx.fillStyle = '#060c12';
      ctx.fillRect(0, 0, W, H);

      // noise
      ctx.globalAlpha = 0.18 + Math.random() * 0.04;
      ctx.drawImage(noiseRef.current, 0, 0);
      ctx.globalAlpha = 1;

      // Horizontal glitch bars
      const numGlitch = Math.floor(Math.random() * 4);
      for (let i = 0; i < numGlitch; i++) {
        const gy = Math.random() * H;
        const gh = 2 + Math.random() * 12;
        ctx.fillStyle = `rgba(0,212,255,${Math.random() * 0.15})`;
        ctx.fillRect(0, gy, W, gh);
      }

      // scanlines
      for (let y = 0; y < H; y += 3) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(0, y, W, 1);
      }

      // rolling scanline
      const scanY = (t * 0.4) % H;
      const grad  = ctx.createLinearGradient(0, scanY - 40, 0, scanY + 40);
      grad.addColorStop(0, 'rgba(0,212,255,0)');
      grad.addColorStop(0.5, 'rgba(0,212,255,0.04)');
      grad.addColorStop(1, 'rgba(0,212,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, scanY - 40, W, 80);

      // vignette
      const vig = ctx.createRadialGradient(W/2,H/2,H*0.3, W/2,H/2,H*0.75);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);
    }

    function drawOnline(t, camId) {
      // Seed-based camera-specific palette
      const seed  = camId ?? 1;
      const hue   = (seed * 47) % 360;
      const hue2  = (hue + 40) % 360;

      // Background scene gradient  
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, `hsl(${hue},30%,4%)`);
      bg.addColorStop(1, `hsl(${hue2},25%,8%)`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Grid lines (floor pattern)
      ctx.strokeStyle = `hsla(${hue},60%,50%,0.06)`;
      ctx.lineWidth   = 1;
      const gs = W / 10;
      for (let x = 0; x < W; x += gs) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += gs) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // Moving entities (simulated detections)
      const numEntities = 2 + (seed % 3);
      for (let i = 0; i < numEntities; i++) {
        const ex = ((Math.sin(t * 0.0008 * (i + 1) + seed * i) + 1) / 2) * (W - 80) + 20;
        const ey = ((Math.cos(t * 0.0006 * (i + 1) + seed) + 1) / 2)     * (H - 100) + 30;
        const ew = 30 + (seed % 15); const eh = 55 + (seed % 20);

        // Bounding box
        ctx.strokeStyle = `hsla(${(hue + i*30)%360},90%,55%,0.75)`;
        ctx.lineWidth   = 1.5;
        ctx.strokeRect(ex, ey, ew, eh);

        // Corner ticks
        const tick = 6;
        ctx.strokeStyle = `hsla(${(hue+i*30)%360},100%,70%,0.95)`;
        ctx.lineWidth = 2;
        [[ex,ey],[ex+ew,ey],[ex,ey+eh],[ex+ew,ey+eh]].forEach(([cx,cy],ci) => {
          const sx = ci%2===0?1:-1; const sy = ci<2?1:-1;
          ctx.beginPath(); ctx.moveTo(cx,cy+sy*tick); ctx.lineTo(cx,cy); ctx.lineTo(cx+sx*tick,cy); ctx.stroke();
        });

        // Label
        ctx.fillStyle = `hsla(${(hue+i*30)%360},90%,60%,0.9)`;
        ctx.font      = `bold ${Math.round(W/55)}px JetBrains Mono, monospace`;
        ctx.fillText(`OBJ-${i+1}`, ex + 2, ey - 4);
      }

      // subtle noise
      ctx.globalAlpha = 0.04;
      ctx.drawImage(noiseRef.current, 0, 0);
      ctx.globalAlpha = 1;

      // scanlines
      for (let y = 0; y < H; y += 3) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(0, y, W, 1);
      }

      // rolling glow line
      const scanY = (t * 0.25) % H;
      const scanGrad = ctx.createLinearGradient(0, scanY - 60, 0, scanY + 60);
      scanGrad.addColorStop(0, 'rgba(0,212,255,0)');
      scanGrad.addColorStop(0.5, 'rgba(0,212,255,0.05)');
      scanGrad.addColorStop(1, 'rgba(0,212,255,0)');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, scanY - 60, W, 120);

      // Vignette
      const vig = ctx.createRadialGradient(W/2,H/2,H*0.2, W/2,H/2,H*0.8);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);
    }

    function frame(t) {
      frameRef.current = t;
      const status = camera?.current_status ?? 'Offline';

      if (status === 'Offline')       drawOffline();
      else if (status === 'Degraded') drawDegraded(t);
      else                            drawOnline(t, camera?.camera_id);

      animRef.current = requestAnimationFrame(frame);
    }

    animRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animRef.current);
  }, [camera?.camera_id, camera?.current_status]);
}

// ─── HUD timestamp ──────────────────────────────────────────────────
function useTimestamp() {
  const [ts, setTs] = useState('');
  useEffect(() => {
    const update = () => setTs(new Date().toISOString().replace('T',' ').slice(0,19));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return ts;
}

// ═══════════════════════════════════════════════════════════════════
export default function StreamTerminal({
  cameras, selectedCamera, onCameraSelect, onCameraUpdate,
  selectedZone, selectedFloor,
}) {
  const canvasRef = useRef(null);
  const ts        = useTimestamp();
  const [pingResult, setPingResult]   = useState(null);
  const [pinging,    setPinging]      = useState(false);
  const [showModal,  setShowModal]    = useState(false);
  const [editCamera, setEditCamera]   = useState(null);
  const [copiedRtsp, setCopiedRtsp]   = useState(false);

  useLiveStream(canvasRef, selectedCamera);

  const doPing = useCallback(async () => {
    if (!selectedCamera || pinging) return;
    setPinging(true);
    setPingResult(null);
    try {
      const res  = await fetch(`/api/cameras/${selectedCamera.camera_id}/ping`, { method:'POST' });
      const data = await res.json();
      setPingResult(data);
      await onCameraUpdate();
    } catch { setPingResult({ status:'Error' }); }
    setPinging(false);
  }, [selectedCamera, pinging, onCameraUpdate]);

  const copyRtsp = () => {
    if (!selectedCamera) return;
    navigator.clipboard.writeText(selectedCamera.rtsp_stream_url);
    setCopiedRtsp(true);
    setTimeout(() => setCopiedRtsp(false), 1500);
  };

  const statusClass = selectedCamera?.current_status?.toLowerCase() ?? 'offline';

  // list of cams shown in sidebar
  const listCams = cameras.slice(0, 30);

  return (
    <div className="stream-panel">
      {/* ── Video Feed ─────────────────────────────────────────── */}
      <div className="video-section">
        <canvas ref={canvasRef} className="video-canvas" style={{ width:'100%', height:'100%' }} />

        {/* HUD */}
        {selectedCamera && (
          <div className="video-overlay-hud">
            <div className="hud-top-left">
              <div className="hud-rec">
                <span className="hud-rec-dot" style={{
                  background: selectedCamera.current_status === 'Online' ? 'var(--status-offline)' : 'var(--text-muted)',
                  boxShadow: selectedCamera.current_status === 'Online' ? '0 0 6px var(--status-offline)' : 'none',
                }} />
                {selectedCamera.current_status === 'Online' ? 'REC' : 'STOPPED'}
              </div>
              <div style={{ fontSize:9, opacity:0.7 }}>{ts}</div>
              <div style={{ fontSize:9, opacity:0.6 }}>CAM-{String(selectedCamera.camera_id).padStart(4,'0')}</div>
            </div>

            <div className="hud-top-right">
              <div style={{ fontSize:9 }}>{selectedCamera.static_ip_address}</div>
              <div style={{ fontSize:9, opacity:0.7 }}>RTSP/H.264</div>
              <div style={{ fontSize:9, opacity:0.6 }}>
                AZ:{selectedCamera.azimuth_angle}° FOV:{selectedCamera.field_of_view}°
              </div>
            </div>

            <div className="hud-bottom-left">
              <div style={{ fontSize:9 }}>{selectedCamera.zone_id} · FL{selectedCamera.floor_number}</div>
              <div style={{ fontSize:9, opacity:0.7 }}>
                {selectedCamera.latitude.toFixed(5)}N {selectedCamera.longitude.toFixed(5)}E
              </div>
            </div>

            <div className="hud-bottom-right">
              {selectedCamera.current_status === 'Online' && (
                <div style={{ fontSize:9, color:'var(--status-online)' }}>
                  {Math.floor(Math.random() * 5 + 23)} fps · {(Math.random()*0.5+1.8).toFixed(1)} Mbps
                </div>
              )}
              {selectedCamera.current_status === 'Degraded' && (
                <div style={{ fontSize:9, color:'var(--status-degraded)' }}>
                  ⚠ DEGRADED · HIGH PKT LOSS
                </div>
              )}
            </div>
          </div>
        )}

        {/* Offline overlay */}
        {(!selectedCamera || selectedCamera.current_status === 'Offline') && (
          <div className="offline-overlay">
            <WifiOff size={36} />
            <div>{selectedCamera ? 'NO SIGNAL' : 'NO CAMERA SELECTED'}</div>
            <div className="no-signal">
              {selectedCamera ? selectedCamera.static_ip_address : 'Click a camera pin on the map'}
            </div>
          </div>
        )}
      </div>

      {/* ── Stream Controls ─────────────────────────────────────── */}
      <div className="stream-controls">
        <button className="ctrl-btn success" title="Play" onClick={() => {}}>▶</button>
        <button className="ctrl-btn" title="Snapshot">
          <Download size={13} />
        </button>
        <div className="ctrl-sep" />
        <button className="ctrl-btn" title="PTZ Left"><RotateCcw size={13} /></button>
        <button className="ctrl-btn" title="Zoom In"><ZoomIn size={13} /></button>
        <button className="ctrl-btn" title="Zoom Out"><ZoomOut size={13} /></button>
        <div className="ctrl-sep" />
        <button
          className="ctrl-btn"
          title="Edit Camera"
          onClick={() => { setEditCamera(selectedCamera); setShowModal(true); }}
          disabled={!selectedCamera}
        >
          <Edit size={13} />
        </button>
        <button className="ctrl-btn" title="Fullscreen">
          <Maximize2 size={13} />
        </button>

        <button
          className="rtsp-badge"
          onClick={copyRtsp}
          title={selectedCamera?.rtsp_stream_url ?? 'No stream'}
        >
          {copiedRtsp ? '✓ Copied!' : (selectedCamera?.rtsp_stream_url ?? 'No stream selected')}
        </button>
      </div>

      {/* ── Asset Info Panel ─────────────────────────────────────── */}
      <div className="asset-info-panel">
        {selectedCamera ? (
          <>
            {/* Asset Card */}
            <div className="asset-card">
              <div className="asset-card-header">
                <Camera size={14} style={{ color:'var(--accent-cyan)', flexShrink:0 }} />
                <div className="asset-card-title">{selectedCamera.camera_name}</div>
                <span className={`status-badge ${statusClass}`}>{selectedCamera.current_status}</span>
              </div>

              <div className="asset-grid">
                <div className="asset-field">
                  <span className="asset-field-label">IP Address</span>
                  <span className="asset-field-value ip">{selectedCamera.static_ip_address}</span>
                </div>
                <div className="asset-field">
                  <span className="asset-field-label">Zone / Floor</span>
                  <span className="asset-field-value">
                    <span className={`zone-badge ${selectedCamera.zone_id}`}>{selectedCamera.zone_id}</span>
                    <span style={{ marginLeft:5 }}>Floor {selectedCamera.floor_number}</span>
                  </span>
                </div>
                <div className="asset-field" style={{ gridColumn:'1/-1' }}>
                  <span className="asset-field-label">MAC Address</span>
                  <span className="asset-field-value mac">{selectedCamera.mac_address}</span>
                </div>
                <div className="asset-field">
                  <span className="asset-field-label">Azimuth</span>
                  <span className="asset-field-value">{selectedCamera.azimuth_angle}°</span>
                </div>
                <div className="asset-field">
                  <span className="asset-field-label">Field of View</span>
                  <span className="asset-field-value">{selectedCamera.field_of_view}°</span>
                </div>
                <div className="asset-field">
                  <span className="asset-field-label">Latitude</span>
                  <span className="asset-field-value">{Number(selectedCamera.latitude).toFixed(6)}</span>
                </div>
                <div className="asset-field">
                  <span className="asset-field-label">Longitude</span>
                  <span className="asset-field-value">{Number(selectedCamera.longitude).toFixed(6)}</span>
                </div>
              </div>

              {/* Ping row */}
              <div className="ping-row">
                <button
                  id="ping-camera-btn"
                  className={`ping-btn ${pinging ? 'pinging' : ''}`}
                  onClick={doPing}
                  disabled={pinging}
                >
                  {pinging ? <span className="spinner" style={{ width:12, height:12 }} /> : <RefreshCw size={12} />}
                  {pinging ? 'Pinging…' : 'Ping'}
                </button>
                {pingResult && (
                  <span className="ping-result">
                    {pingResult.status === 'Online'
                      ? `✅ ${pingResult.latency_ms}ms · ${pingResult.packet_loss_pct}% loss`
                      : pingResult.status === 'Degraded'
                      ? `⚠️ ${pingResult.latency_ms}ms · ${pingResult.packet_loss_pct}% loss`
                      : '❌ No response'}
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <Camera size={32} />
            <p>Select a camera from the map or search bar to view its live feed and hardware details.</p>
          </div>
        )}

        {/* Camera List */}
        <div className="camera-list-section">
          <div className="section-header">
            <Camera size={12} style={{ color:'var(--text-muted)' }} />
            <span className="section-title">
              {selectedZone !== 'ALL' ? selectedZone : 'All'} Cameras
              {selectedFloor !== null ? ` · Floor ${selectedFloor}` : ''}
              {' '}({cameras.length})
            </span>
            <button
              id="add-camera-btn"
              className="add-cam-btn"
              onClick={() => { setEditCamera(null); setShowModal(true); }}
            >
              <Plus size={11} /> Add
            </button>
          </div>

          {listCams.length === 0 ? (
            <div className="empty-state" style={{ padding:16 }}>
              <p>No cameras in this view</p>
            </div>
          ) : (
            listCams.map(cam => (
              <div
                key={cam.camera_id}
                id={`cam-list-item-${cam.camera_id}`}
                className={`cam-list-item ${selectedCamera?.camera_id === cam.camera_id ? 'selected' : ''}`}
                onClick={() => onCameraSelect(cam)}
              >
                <span className={`cam-list-dot ${cam.current_status.toLowerCase()}`} />
                <span className="cam-list-name">{cam.camera_name}</span>
                <span className="cam-list-ip">{cam.static_ip_address}</span>
              </div>
            ))
          )}
          {cameras.length > 30 && (
            <div style={{ padding:'6px 12px', fontSize:10, color:'var(--text-muted)', textAlign:'center' }}>
              +{cameras.length - 30} more cameras. Use the search bar to find specific nodes.
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <AddEditCameraModal
          camera={editCamera}
          onClose={() => { setShowModal(false); setEditCamera(null); }}
          onSave={async () => { setShowModal(false); setEditCamera(null); await onCameraUpdate(); }}
        />
      )}
    </div>
  );
}
