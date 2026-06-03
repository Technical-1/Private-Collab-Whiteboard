// Map a compass anchor enum to a point on a bbox's edge (or center).
export function resolveAnchor(bbox, anchor) {
  const { x, y, width: w, height: h } = bbox;
  switch (anchor) {
    case 'n': return { x: x + w / 2, y };
    case 's': return { x: x + w / 2, y: y + h };
    case 'e': return { x: x + w, y: y + h / 2 };
    case 'w': return { x, y: y + h / 2 };
    case 'c':
    default:  return { x: x + w / 2, y: y + h / 2 };
  }
}

// Choose facing edge anchors based on the dominant axis between two bboxes' centers.
export function nearestAnchors(a, b) {
  const ax = a.x + a.width / 2, ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2, by = b.y + b.height / 2;
  const dx = bx - ax, dy = by - ay;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: 'e', to: 'w' } : { from: 'w', to: 'e' };
  }
  return dy >= 0 ? { from: 's', to: 'n' } : { from: 'n', to: 's' };
}

// A connector is dangling if either endpoint id is absent from the live id set.
export function isDangling(conn, idSet) {
  return !idSet.has(conn.fromId) || !idSet.has(conn.toId);
}

// Indices of connectors in `items` whose endpoint no longer exists, returned in
// DESCENDING order so a caller can delete them in sequence without invalidating
// the remaining indices. Pure: the caller does the actual Y.Array deletion.
export function danglingConnectorIndices(items) {
  const ids = new Set(items.map(s => s.id));
  const out = [];
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].tool === 'connector' && isDangling(items[i], ids)) out.push(i);
  }
  return out;
}

// The four edge-midpoint anchor points (N, E, S, W) of a bbox — drawn as
// connection hints while the connector tool is active. Reuses the same edge
// math as resolveAnchor.
export function edgeAnchorPoints(bbox) {
  const { x, y, width: w, height: h } = bbox;
  return [
    { x: x + w / 2, y },        // n
    { x: x + w, y: y + h / 2 }, // e
    { x: x + w / 2, y: y + h }, // s
    { x, y: y + h / 2 },        // w
  ];
}

// The edge anchor (of n/e/s/w) closest to a point — used to start the connector
// rubber-band preview from the hint dot the cursor is nearest, matching where it binds.
export function nearestAnchorToPoint(bbox, px, py) {
  const pts = edgeAnchorPoints(bbox);
  let best = pts[0], bestD = Infinity;
  for (const p of pts) {
    const d = (p.x - px) ** 2 + (p.y - py) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}
