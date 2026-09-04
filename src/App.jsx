import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header.jsx';
import GisMapCanvas from './components/GisMapCanvas.jsx';
import StreamTerminal from './components/StreamTerminal.jsx';
import CameraDashboard from './components/CameraDashboard.jsx';

export default function App() {
  const [cameras, setCameras]           = useState([]);
  const [stats, setStats]               = useState(null);
  const [selectedZone, setSelectedZone] = useState('ALL');
  const [selectedFloor, setSelectedFloor] = useState(null);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [flashCameraId, setFlashCameraId]   = useState(null);
  const [loading, setLoading]           = useState(true);
  const [theme, setTheme]               = useState('dark');
  const [view, setView]                 = useState('map'); // 'map' | 'dashboard'

  // Apply theme class to body
  useEffect(() => {
    if (theme === 'light') document.body.classList.add('light-theme');
    else document.body.classList.remove('light-theme');
  }, [theme]);

  // ── Fetch all cameras ──────────────────────────────────────────────
  const fetchCameras = useCallback(async () => {
    try {
      const res  = await fetch('/api/cameras');
      const data = await res.json();
      setCameras(data);
    } catch (e) {
      console.error('fetchCameras:', e);
    }
  }, []);

  // ── Fetch stats ────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const res  = await fetch('/api/stats');
      const data = await res.json();
      setStats(data);
    } catch (e) { console.error('fetchStats:', e); }
  }, []);

  // ── Initial load ───────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchCameras(), fetchStats()]);
      setLoading(false);
    })();
  }, [fetchCameras, fetchStats]);

  // ── Auto refresh stats every 15 s ─────────────────────────────────
  useEffect(() => {
    const id = setInterval(fetchStats, 15000);
    return () => clearInterval(id);
  }, [fetchStats]);

  // ── Handle zone change ─────────────────────────────────────────────
  const handleZoneChange = useCallback((zone) => {
    setSelectedZone(zone);
    setSelectedFloor(null);       // reset floor on zone switch
    setSelectedCamera(null);
  }, []);

  // ── Handle search result select ───────────────────────────────────
  const handleSearchSelect = useCallback((cam) => {
    setSelectedZone(cam.zone_id);
    setSelectedFloor(cam.floor_number);
    setSelectedCamera(cam);
    setFlashCameraId(cam.camera_id);
    setTimeout(() => setFlashCameraId(null), 2500);
  }, []);

  // ── Dashboard row click: jump back to the map focused on that cam ──
  const handleDashboardLocate = useCallback((cam) => {
    setView('map');
    handleSearchSelect(cam);
  }, [handleSearchSelect]);

  // ── Handle camera click on map ────────────────────────────────────
  const handleCameraSelect = useCallback((cam) => {
    setSelectedCamera(cam);
  }, []);

  // ── Handle add/edit camera ────────────────────────────────────────
  const handleCameraUpdate = useCallback(async () => {
    await fetchCameras();
    await fetchStats();
  }, [fetchCameras, fetchStats]);

  // ── Ping all (triggered by header) ───────────────────────────────
  const handlePingAll = useCallback(async () => {
    await fetch('/api/ping-all', { method: 'POST' });
    await Promise.all([fetchCameras(), fetchStats()]);
  }, [fetchCameras, fetchStats]);

  // ── Derived filtered cameras ──────────────────────────────────────
  const filteredCameras = cameras.filter(c => {
    if (selectedZone !== 'ALL' && c.zone_id !== selectedZone) return false;
    if (selectedFloor !== null && c.floor_number !== selectedFloor) return false;
    return true;
  });

  return (
    <div className="app-shell">
      <Header
        stats={stats}
        selectedZone={selectedZone}
        onZoneChange={handleZoneChange}
        onSearchSelect={handleSearchSelect}
        onPingAll={handlePingAll}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        view={view}
        onViewChange={setView}
      />

      <div className="app-body">
        <GisMapCanvas
          cameras={cameras}
          filteredCameras={filteredCameras}
          selectedZone={selectedZone}
          selectedFloor={selectedFloor}
          selectedCamera={selectedCamera}
          flashCameraId={flashCameraId}
          onFloorChange={setSelectedFloor}
          onCameraSelect={handleCameraSelect}
          onZoneSelect={handleZoneChange}
          loading={loading}
          theme={theme}
        />

        <StreamTerminal
          cameras={filteredCameras}
          selectedCamera={selectedCamera}
          onCameraSelect={handleCameraSelect}
          onCameraUpdate={handleCameraUpdate}
          selectedZone={selectedZone}
          selectedFloor={selectedFloor}
        />

        {/* Full-screen camera dashboard overlay (map stays alive underneath) */}
        {view === 'dashboard' && (
          <CameraDashboard
            cameras={cameras}
            stats={stats}
            onSelectCamera={handleDashboardLocate}
            onClose={() => setView('map')}
          />
        )}
      </div>
    </div>
  );
}
