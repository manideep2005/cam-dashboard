# CAMMAP-GIS — Campus Geo-Surveillance IP-Mapper

[![CI/CD](https://github.com/manideep2005/cam-dashboard/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/manideep2005/cam-dashboard/actions/workflows/ci-cd.yml)

Interactive CCTV camera placement & monitoring dashboard on a Leaflet map.
Built on the principle of **progressive disclosure**: zone clusters at campus
zoom → per-floor clusters inside a zone → individual camera pins → camera
detail on click. Never renders hundreds of overlapping pins at once.

**Live demo:** https://liveviewer-eight.vercel.app

## Stack

- **Frontend:** React 18 + Vite + Leaflet (react-leaflet) + lucide-react
- **Backend:** Express (serverless-ready), SQLite via better-sqlite3
- **Hosting:** Vercel — static frontend + serverless API (`api/index.js`),
  DB auto-seeded into `/tmp` on cold start (see `DEPLOYMENT.md`)

## Getting started

```bash
npm install
npm run seed      # generates the dataset (25 cameras/floor, 725 total)
npm run dev       # API on :3001 + Vite on :5173
npm run build     # production frontend build
```

- **Scale the dataset:** change `CAMS_PER_FLOOR` in `server/seed.js` and re-seed.
- **Import real cameras:** `npm run import -- path/to/cameras.csv`
  (format documented in `server/import-cameras.js` and `server/sample-cameras.csv`).

## CI/CD

Every push / pull request runs the **CI checks** (install → build → serverless
API smoke test). Every push to `main` then **deploys to Vercel production**
automatically (`.github/workflows/ci-cd.yml`).

The org/project IDs are pinned in the workflow; the only secret needed is
`VERCEL_TOKEN`:

1. Vercel → **Account Settings → Tokens → Create Token** (scope: Full Account).
2. GitHub repo → **Settings → Secrets and variables → Actions → New
   repository secret** → name `VERCEL_TOKEN`, paste the token.
3. Re-run the deploy job (or push any commit) — it now ships to production.

## Data persistence note

Vercel serverless functions are stateless: the SQLite file lives in `/tmp`
and resets on cold start, so cameras added through the UI are not kept on the
deployed site (the deterministic seed always repopulates the map). See
`DEPLOYMENT.md` for the Turso (hosted SQLite) upgrade path if you need to
persist real camera data.