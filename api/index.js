// ─────────────────────────────────────────────────────────────────────
//  Vercel serverless entry point.
//
//  vercel.json rewrites every /api/* request here. The Express app keeps
//  its full `/api/...` route prefixes — Vercel passes the original URL
//  through to the function, so routing works unchanged.
// ─────────────────────────────────────────────────────────────────────
import app from '../server/app.js';

export default app;