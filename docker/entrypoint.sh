#!/bin/sh
set -e

echo "[cammap] ensuring camera data is present…"
node server/ensure-seed.js

echo "[cammap] starting server on :${PORT:-3001}"
exec node server/index.js