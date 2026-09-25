/**
 * Measuring garden outlines drawn on a map. Points are latitude/longitude;
 * garden beds are small enough that a flat local projection around the
 * outline is accurate to well under 1%.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Project to metres east/north of the outline's first point. */
function toLocalMetres(points: readonly LatLon[]): { x: number; y: number }[] {
  if (!points.length) return [];
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const o = points[0];
  const kx = EARTH_RADIUS_M * Math.cos(rad(lat0));
  return points.map((p) => ({ x: rad(p.lon - o.lon) * kx, y: rad(p.lat - o.lat) * EARTH_RADIUS_M }));
}

/** Area enclosed by the outline, in m² (0 for fewer than 3 points). */
export function polygonAreaM2(points: readonly LatLon[]): number {
  if (points.length < 3) return 0;
  const xy = toLocalMetres(points);
  let twice = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** Distance around the outline, in metres. */
export function perimeterM(points: readonly LatLon[]): number {
  if (points.length < 2) return 0;
  const xy = toLocalMetres(points);
  let total = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/**
 * Length × width of the smallest rectangle (at any angle) around the outline —
 * "about 4 m × 1.2 m" for a bed, whichever way it faces.
 */
export function outlineDimensionsM(points: readonly LatLon[]): { lengthM: number; widthM: number } | null {
  if (points.length < 3) return null;
  const xy = toLocalMetres(points);
  let best: { area: number; a: number; b: number } | null = null;
  for (let i = 0; i < xy.length; i++) {
    const p = xy[i];
    const q = xy[(i + 1) % xy.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < 1e-9) continue;
    const ux = (q.x - p.x) / len;
    const uy = (q.y - p.y) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const r of xy) {
      const u = r.x * ux + r.y * uy;
      const v = -r.x * uy + r.y * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const a = maxU - minU;
    const b = maxV - minV;
    if (!best || a * b < best.area) best = { area: a * b, a, b };
  }
  if (!best) return null;
  return { lengthM: Math.max(best.a, best.b), widthM: Math.min(best.a, best.b) };
}

/** Rounded to 0.1, for storing measurements that are only ever approximate. */
export function roundTenth(n: number): number {
  return Math.round(n * 10) / 10;
}

export function centroid(points: readonly LatLon[]): LatLon | null {
  if (!points.length) return null;
  return { lat: points.reduce((s, p) => s + p.lat, 0) / points.length, lon: points.reduce((s, p) => s + p.lon, 0) / points.length };
}
