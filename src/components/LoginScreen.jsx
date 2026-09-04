import React, { useState } from 'react';
import { Eye, EyeOff, Lock, LogIn, ShieldCheck, User } from 'lucide-react';

export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
        setBusy(false);
        return;
      }
      onLogin(data.user);
    } catch {
      setError('Could not reach the server');
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">🛰️</div>
        <h1 className="login-title">CAMMAP-GIS</h1>
        <p className="login-sub">Geo-Surveillance IP-Mapper</p>
        <div className="login-restricted">
          <ShieldCheck size={12} />
          Restricted — authorized personnel only
        </div>

        <div className="login-field">
          <User size={14} />
          <input
            autoFocus
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
          />
        </div>
        <div className="login-field">
          <Lock size={14} />
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
          />
          <button type="button" className="login-eye" onClick={() => setShowPw(!showPw)} title={showPw ? 'Hide password' : 'Show password'}>
            {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>

        {error && <div className="login-error">{error}</div>}

        <button className="login-btn" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <LogIn size={14} />}
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="login-foot">Session protected · camera data requires authentication</div>
      </form>
    </div>
  );
}