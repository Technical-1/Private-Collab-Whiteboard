// How long a laser trail point stays visible.
export const MAX_TRAIL_AGE_MS = 700;

// Drop points older than MAX_TRAIL_AGE_MS relative to `now`. Pure: caller passes
// the current timestamp (Date.now() at the call site).
export function pruneTrail(points, now) {
  if (!Array.isArray(points)) return [];
  return points.filter(p => p && now - p.t <= MAX_TRAIL_AGE_MS);
}
