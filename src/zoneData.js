// ── Single source of truth for zone geometry ────────────────────────
// Imported by the map (src/components/GisMapCanvas.jsx) AND by the
// database seed (server/seed.js), so polygons and camera layouts can
// never drift apart.

export const ZONE_COLOR = {
  CB:  '#3b82f6',
  FS:  '#f59e0b',
  AB1: '#10b981',
  AB2: '#8b5cf6',
  RP:  '#ec4899',
};

export const ZONE_NAME = {
  CB:  'Central Block',
  FS:  'Food Street',
  AB1: 'Academic Block 1',
  AB2: 'Academic Block 2',
  RP:  'Rock Plaza',
};

// Zone polygon footprints (lat/lng rings). RP sits immediately WEST of
// Food Street (Food Street spans lng 80.49806–80.49865).
export const ZONE_POLYGONS = {
  CB:  [[16.4946806,80.4998706],[16.4945793,80.4998672],[16.4940109,80.499172],[16.4941122,80.4991754]],
  FS:  [[16.4940749,80.4984864],[16.4937975,80.4982254],[16.4936180,80.4980565],[16.4933875,80.4982849],[16.4938045,80.4986482],[16.4940749,80.4984864]],
  AB1: [[16.4953695,80.5002541],[16.4956387,80.5005322],[16.4961791,80.5004479],[16.4959099,80.5001698]],
  AB2: [[16.4954878,80.4986099],[16.4953695,80.4982291],[16.4960579,80.4977198],[16.4961762,80.4981006]],
  RP:  [[16.4939500,80.4979500],[16.4939500,80.4974500],[16.4933500,80.4974500],[16.4933500,80.4979500]],
};

// Zone centres for cluster pins / fly-to targets
export const ZONE_CENTER = {
  CB:  [16.494381, 80.499227],
  FS:  [16.493792, 80.498364],
  AB1: [16.495774, 80.500351],
  AB2: [16.495772, 80.498164],
  RP:  [16.493650, 80.497700],
};

// Max floor per zone
export const FLOOR_MAX = { CB: 8, FS: 4, AB1: 4, AB2: 4, RP: 4 };

// Bounding box of a zone's polygon
export function zoneBounds(zone) {
  const pts = ZONE_POLYGONS[zone];
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  pts.forEach(([la, ln]) => {
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (ln < minLng) minLng = ln;
    if (ln > maxLng) maxLng = ln;
  });
  return { minLat, maxLat, minLng, maxLng };
}