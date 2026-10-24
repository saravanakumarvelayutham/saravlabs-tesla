// Map tiles for route traces: Web Mercator math and the dark restyle of OpenStreetMap tiles.
//
// Tiles come straight from tile.openstreetmap.org: no key or account, and the OSMF tile usage
// policy (operations.osmfoundation.org/policies/tiles) allows light use from browsers that send
// their normal Referer and User-Agent and show the attribution on the map. Tiles are only fetched
// for the map on screen, never prefetched, and the service worker doesn't store them (the policy
// forbids prefetching and offline use).

export const TILE = 256;
export const MAX_ZOOM = 17;
export const TILE_URL = 'https://tile.openstreetmap.org';
export const ATTRIBUTION = '© OpenStreetMap contributors';
export const ATTRIBUTION_URL = 'https://www.openstreetmap.org/copyright';

// World pixel coordinates at zoom z (the projection OpenStreetMap tiles use).
export const mercX = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
export function mercY(lat, z) {
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
}

// Fits [lat, lon] points into a w×h box with pad pixels each side, at the largest zoom (up to
// MAX_ZOOM) where they all fit. Returns the zoom, the box's world-pixel origin, and projectors.
export function fitView(points, { w, h, pad }) {
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const [minLat, maxLat, minLon, maxLon] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  let z = MAX_ZOOM;
  while (z > 1 && (mercX(maxLon, z) - mercX(minLon, z) > w - pad * 2 || mercY(minLat, z) - mercY(maxLat, z) > h - pad * 2)) z--;
  const ox = (mercX(minLon, z) + mercX(maxLon, z)) / 2 - w / 2;
  const oy = (mercY(minLat, z) + mercY(maxLat, z)) / 2 - h / 2;
  return { z, ox, oy, X: (lon) => mercX(lon, z) - ox, Y: (lat) => mercY(lat, z) - oy };
}

// Every tile that touches the box, with where it goes inside it. x wraps at the antimeridian.
export function tilesFor({ z, ox, oy }, w, h) {
  const n = 2 ** z;
  const out = [];
  for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + h - 1e-9) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + w - 1e-9) / TILE); tx++) {
      const x = ((tx % n) + n) % n;
      out.push({ url: `${TILE_URL}/${z}/${x}/${ty}.png`, x: tx * TILE - ox, y: ty * TILE - oy });
    }
  }
  return out;
}

// Views re-render on every live signal, and a fresh <image href="https://..."> makes the browser
// ask the tile server again each time. So each tile is fetched once (OSM sends CORS headers), held
// as a blob: URL for this page session, and onReady re-renders once it arrives. A failed tile is
// retried after RETRY_MS. The oldest blobs are released past MAX_HELD.
const RETRY_MS = 5 * 60_000;
const MAX_HELD = 64;
const held = new Map(); // url -> blob: URL, null while loading, or the time a failed tile may be retried
export function tileHref(url, onReady, now = Date.now()) {
  const v = held.get(url);
  if (typeof v === 'string' || v === null) return v;
  if (typeof v === 'number' && now < v) return null;
  held.set(url, null);
  fetch(url, { mode: 'cors', credentials: 'omit' })
    .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.blob(); })
    .then((blob) => {
      held.set(url, URL.createObjectURL(blob));
      for (const [k, b] of held) {
        if (held.size <= MAX_HELD) break;
        if (typeof b === 'string') { URL.revokeObjectURL(b); held.delete(k); }
      }
      onReady();
    }, () => held.set(url, Date.now() + RETRY_MS));
  return null;
}

// SVG filter that turns the standard (light) OpenStreetMap style into the dashboard look:
// black land, steel-blue streets, brighter major roads, navy water. Labels, buildings and parks
// drop out so the route trace stays the brightest thing on the map.
//   1. Split each pixel into three masks: white minor streets (luminance), colored major roads
//      (red well above blue: OSM draws them orange, pink and yellow), and water (blue above red).
//   2. Keep only near-white for the street mask, so the off-white land (#F2EFE9) goes dark.
//   3. Mix the masks into the palette over the --bg-like base color.
export function darkFilter(id) {
  return `<filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
    <feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0  2.6 0 -2.6 0 -0.4  -3 0 3 0 -0.25  0 0 0 0 1"></feColorMatrix>
    <feComponentTransfer><feFuncR type="linear" slope="26" intercept="-25"></feFuncR></feComponentTransfer>
    <feColorMatrix type="matrix" values="0.06 0.12 0 0 0.024  0.20 0.38 0.05 0 0.043  0.25 0.46 0.13 0 0.07  0 0 0 0 1"></feColorMatrix>
  </filter>`;
}
