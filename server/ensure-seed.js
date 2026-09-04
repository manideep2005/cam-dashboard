// ─────────────────────────────────────────────────────────────────────
//  Docker entrypoint helper: seed the camera data only if the database
//  is empty (first start on a fresh volume). Never wipes existing data.
// ─────────────────────────────────────────────────────────────────────
import db, { seedIfEmpty } from './db.js';

const total = seedIfEmpty();
console.log(`[cammap] database ready — ${total} cameras`);

const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
console.log(`[cammap] ${users} user account(s) configured`);
db.close();