import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Radio, Wifi, WifiOff, Activity, Shield, Sun, Moon, LayoutDashboard, LogOut, ShieldCheck } from 'lucide-react';

const ZONES = ['ALL','CB','FS','AB1','AB2','RP'];
const ZONE_LABELS = {
  ALL: 'All Zones',
  CB:  'Central Block',
  FS:  'Food Street',
  AB1: 'Academic Block 1',
  AB2: 'Academic Block 2',
  RP:  'Rock Plaza',
};

export default function Header({ stats, selectedZone, onZoneChange, onSearchSelect, onPingAll, theme, onToggleTheme, view = 'map', onViewChange, user, onLogout }) {
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDrop, setShowDrop]   = useState(false);
  const [pinging, setPinging]     = useState(false);
  const debounceRef = useRef(null);
  const wrapRef     = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowDrop(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); setShowDrop(false); return; }
    setSearching(true);
    try {
      const res  = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.slice(0, 12));
      setShowDrop(true);
    } catch { setResults([]); }
    setSearching(false);
  }, []);

  const handleInput = (e) => {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 280);
  };

  const handleSelect = (cam) => {
    onSearchSelect(cam);
    setQuery(cam.camera_name);
    setShowDrop(false);
  };

  const handlePingAll = async () => {
    if (pinging) return;
    setPinging(true);
    await onPingAll();
    setPinging(false);
  };

  const statusColor = (s) =>
    s === 'Online' ? 'var(--status-online)' :
    s === 'Offline' ? 'var(--status-offline)' :
    'var(--status-degraded)';

  return (
    <header className="header">
      {/* Logo */}
      <div className="header-logo">
        <div className="logo-icon">🛰️</div>
        <div>
          <div className="logo-text">CAMMAP-GIS</div>
          <div className="logo-sub">Geo-Surveillance IP-Mapper</div>
        </div>
      </div>

      {/* Centre: zone tabs + search */}
      <div className="header-centre">
        {/* Zone Tabs */}
        <div className="zone-tabs">
          {ZONES.map(z => (
            <button
              key={z}
              id={`zone-tab-${z}`}
              className={`zone-tab zone-${z.toLowerCase()} ${selectedZone === z ? 'active' : ''}`}
              onClick={() => onZoneChange(z)}
              title={ZONE_LABELS[z]}
            >
              {z}
            </button>
          ))}

          {/* Ping-all button */}
          <button
            className="map-ctrl-btn"
            style={{ marginLeft: 8, fontSize: 10, height: 22, padding: '0 10px' }}
            onClick={handlePingAll}
            disabled={pinging}
            title="Sweep-ping all cameras"
          >
            {pinging
              ? <span className="spinner" style={{ width: 10, height: 10 }} />
              : <Activity size={11} />}
            {pinging ? 'Sweeping…' : 'Ping All'}
          </button>
          
          <button 
            className="map-ctrl-btn"
            style={{ fontSize: 10, height: 22, padding: '0 10px' }}
            onClick={onToggleTheme}
            title="Toggle Light/Dark Theme"
          >
            {theme === 'light' ? <Moon size={11} /> : <Sun size={11} />}
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>

          {/* Dashboard toggle */}
          <button
            id="dashboard-toggle"
            className={`map-ctrl-btn ${view === 'dashboard' ? 'active' : ''}`}
            style={{ fontSize: 10, height: 22, padding: '0 10px' }}
            onClick={() => onViewChange?.(view === 'dashboard' ? 'map' : 'dashboard')}
            title={view === 'dashboard' ? 'Back to GIS map' : 'Open full camera dashboard'}
          >
            <LayoutDashboard size={11} />
            {view === 'dashboard' ? 'Map' : 'Dashboard'}
          </button>
        </div>

        {/* Search */}
        <div className="search-wrap" ref={wrapRef}>
          <Search size={13} className="search-icon" />
          <input
            id="global-search"
            className="search-input"
            placeholder={`Search "CB Floor 5" · "192.168.13.45" · camera name…`}
            value={query}
            onChange={handleInput}
            onFocus={() => results.length && setShowDrop(true)}
            autoComplete="off"
          />
          {searching && (
            <span className="spinner" style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', width:12, height:12 }} />
          )}

          {showDrop && results.length > 0 && (
            <div className="search-dropdown">
              {results.map(cam => (
                <div
                  key={cam.camera_id}
                  className="search-result-item"
                  onMouseDown={() => handleSelect(cam)}
                >
                  <span
                    className="cam-list-dot"
                    style={{
                      width:8, height:8, borderRadius:'50%', flexShrink:0,
                      background: statusColor(cam.current_status),
                      boxShadow: `0 0 5px ${statusColor(cam.current_status)}`,
                    }}
                  />
                  <div style={{ flex: 1, minWidth:0 }}>
                    <div className="search-result-name">{cam.camera_name}</div>
                    <div className="search-result-ip">{cam.static_ip_address}</div>
                  </div>
                  <div className="search-result-meta">
                    <span className={`zone-badge ${cam.zone_id}`}>{cam.zone_id}</span>
                    <span style={{ marginLeft:5, fontSize:9, color:'var(--text-muted)' }}>FL{cam.floor_number}</span>
                  </div>
                </div>
              ))}
              {results.length === 0 && (
                <div style={{ padding:'12px', color:'var(--text-muted)', fontSize:12, textAlign:'center' }}>
                  No cameras found
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Pulse Metrics */}
      <div className="pulse-metrics">
        <div className="metric-chip">
          <span className="metric-chip-value">{stats?.total ?? '—'}</span>
          <span className="metric-chip-label">Nodes</span>
        </div>
        <div className="metric-chip online">
          <span className="metric-chip-value">{stats?.online ?? '—'}</span>
          <span className="metric-chip-label">Online</span>
        </div>
        <div className="metric-chip offline">
          <span className="metric-chip-value">{stats?.offline ?? '—'}</span>
          <span className="metric-chip-label">Offline</span>
        </div>
        <div className="metric-chip degraded">
          <span className="metric-chip-value">{stats?.degraded ?? '—'}</span>
          <span className="metric-chip-label">Degraded</span>
        </div>
        <div className="metric-chip nvr" title={`NVR Core Host: ${stats?.nvr_host}`}>
          <span className="metric-chip-value">
            <span className="nvr-dot" />
            {stats?.uptime_pct ?? '—'}%
          </span>
          <span className="metric-chip-label">Uptime</span>
        </div>
        <div className="metric-chip">
          <span className="metric-chip-value" style={{ color:'var(--accent-cyan)' }}>
            {stats?.bandwidth_mbps ?? '—'}
          </span>
          <span className="metric-chip-label">Mbps</span>
        </div>

        {/* Signed-in user + sign out */}
        {user && (
          <div className="metric-chip user" title={`Signed in as ${user.username}`}>
            <span className="user-chip-name"><ShieldCheck size={11} /> {user.username}</span>
            <button className="logout-btn" onClick={onLogout} title="Sign out"><LogOut size={11} /></button>
          </div>
        )}
      </div>
    </header>
  );
}
