// ─────────────────────────────────────────────────────────────────────
//  Authentication — zero new dependencies.
//
//  - Passwords: salted scrypt hash (node:crypto).
//  - Sessions:  signed HS256 JWT stored in an httpOnly, SameSite cookie.
//               Stateless → survives Vercel cold starts (the SQLite DB
//               does NOT — sessions must not live there).
//  - Secret:    AUTH_SECRET env var. Without it a dev fallback is used
//               and a loud warning is printed — never ship that fallback.
// ─────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import db from './db.js';

const JWT_SECRET   = process.env.AUTH_SECRET || 'cammap-dev-insecure-secret-CHANGE-ME';
const TOKEN_TTL_S  = 12 * 60 * 60;                       // 12 h session
const COOKIE_NAME  = 'cammap_session';

if (!process.env.AUTH_SECRET) {
  console.warn('[auth] ⚠ AUTH_SECRET env var not set — using an insecure dev secret. Set AUTH_SECRET in production (Vercel / Docker).');
}

// ── Password hashing (scrypt) ─────────────────────────────────────────
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const candidate = crypto.scryptSync(String(password), salt, 64);
    return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

// ── Admin bootstrap ───────────────────────────────────────────────────
// Creates the first user when the users table is empty. Credentials come
// from ADMIN_USER / ADMIN_PASSWORD env vars (defaults: admin / admin123).
export function ensureAdminUser() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (c > 0) return;

  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?,?,?)')
    .run(username, hashPassword(password), 'admin');
  console.warn(
    `[auth] Created admin user "${username}".` +
    (process.env.ADMIN_PASSWORD
      ? ' (credentials from ADMIN_USER/ADMIN_PASSWORD env)'
      : ' ⚠ Using DEFAULT password "admin123" — set ADMIN_USER/ADMIN_PASSWORD env vars.'));
}

// ── JWT (HS256) ───────────────────────────────────────────────────────
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

function signToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_S,
  }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = String(token).split('.');
    if (!header || !body || !sig) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Cookie helpers ────────────────────────────────────────────────────
function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  });
  return out;
}

export function setSessionCookie(res, userId, username, role, secure) {
  const token = signToken({ sub: String(userId), username, role });
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TOKEN_TTL_S}${secure ? '; Secure' : ''}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function getSessionUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  return verifyToken(token);
}

// ── Guard for protected routes ────────────────────────────────────────
export function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  req.user = user;
  next();
}