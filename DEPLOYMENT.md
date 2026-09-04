# Deploying CAMMAP-GIS to Vercel

This project is **already configured for Vercel** — the files below are in place:

| File | Purpose |
|------|---------|
| `api/index.js` | Serverless entry point — exports the Express app |
| `server/app.js` | All API routes (framework-agnostic, no `listen`) |
| `server/index.js` | Local dev listener (`npm run server`) |
| `server/db.js` | Vercel-aware SQLite path (`/tmp`) + auto-seed on cold start |
| `server/camera-generator.js` | Deterministic camera generator (seed + auto-seed) |
| `vercel.json` | Rewrites: `/api/*` → serverless function, everything else → SPA |
| `.vercelignore` | Excludes the local DB and sandbox files from upload |
| `package.json` | `engines.node = 20.x` so the runtime matches `better-sqlite3` |

---

## How it works on Vercel

- **Frontend** — Vercel detects Vite, runs `npm run build` (`vite build` → `dist/`), and serves it
  from its CDN. All API calls are **relative** (`/api/...`), so no CORS or env vars are needed.
- **Backend** — `vercel.json` rewrites `/api/(.*)` to the `api/index.js` serverless function. The
  Express app receives the original URL, so all existing routes (`/api/cameras`,
  `/api/stats`, `/api/search`, …) work unchanged.
- **Database** — Vercel functions have a read-only filesystem except `/tmp`, so the SQLite file
  lives at `/tmp/cammap.db`. On a **cold start** (fresh instance) the table is empty, so
  `server/db.js` auto-seeds the full dataset (deterministic — every instance produces the
  identical 725-camera layout). No manual seed step on Vercel.

---

## Option A — Deploy with the Vercel CLI (recommended, ~2 min)

```bash
# 1. Install the CLI once
npm i -g vercel

# 2. From the project root — log in and link the project
vercel login
vercel link

# 3. Preview deployment (gets a *.vercel.app URL)
vercel

# 4. Production deployment
vercel --prod
```

That's it — no environment variables are required. Every subsequent `vercel --prod` (or
`git push` if the repo is connected in the Vercel dashboard) redeploys.

## Option B — Deploy via the Vercel dashboard

1. Push this repo to GitHub.
2. Import it at https://vercel.com/new.
3. Framework preset auto-detects **Vite**; build command `npm run build`, output dir `dist`.
4. Deploy. (Vercel picks up `api/` + `vercel.json` automatically.)

---

## What to verify after deploying

- Open the URL → map loads with the 5 zone clusters and correct camera counts.
- Click a zone → floor clusters → individual cameras (clustering still works at scale).
- `https://<your-app>.vercel.app/api/stats` returns JSON with `total: 725`.
- Add a camera via the **+ Add** button → works, and a duplicate IP returns the friendly
  "already in use" message instead of a SQLite error.

---

## ⚠️ Important: data persistence (read this)

Vercel serverless functions are **stateless**:

- The DB lives in `/tmp`, which is **ephemeral per instance** and resets when Vercel scales to
  zero or spins up a new instance.
- **Anything you add/edit via the UI (or `npm run import`) is lost on the next cold start** —
  the map always falls back to the deterministic auto-seed. Status changes from "ping all"
  are simulated anyway, so nothing there is real data.
- The auto-seed is instant (725 rows in one transaction, well under the 10 s limit).

This is fine for a **demo / college presentation**. If you later need real persistence
(real IPs you must keep, or actual added cameras), the cleanest upgrade is **Turso**
(a hosted SQLite — same schema, zero query changes):

1. Create a DB at https://turso.tech, copy the URL + auth token.
2. `npm i @libsql/client` and swap the `better-sqlite3` calls for libSQL's identical API
   (`prepare().all()/.get()/.run()` work the same), or use
   `better-sqlite3`'s HTTP backend (Turso speaks the same protocol).
3. Set `TURSO_URL` / `TURSO_AUTH_TOKEN` in Vercel project settings.
4. Remove the `/tmp` fallback + auto-seed (or keep it as a bootstrapper that imports
   real data once).

---

## Local development is unchanged

```bash
npm install
npm run seed     # (only needed locally; Vercel auto-seeds)
npm run dev      # API :3001 + Vite :5173 (Vite proxies /api → :3001)
npm run build    # production frontend build
```

## Troubleshooting

- **Build fails on `better-sqlite3`**: it ships prebuilt binaries for Node 20 / linux-x64
  (Vercel's runtime). If a compile is attempted and fails, add
  `"installCommand": "npm rebuild better-sqlite3"` to project settings — or switch to Node 20
  via `engines` (already set).
- **`/api` returns 404 on deploy**: make sure `vercel.json` rewrites are present and the
  function is named `api/index.js` (Vercel maps it to `/api`).
- **Empty map right after deploy**: give it one request — the first cold start auto-seeds.
  Subsequent requests see the seeded data.