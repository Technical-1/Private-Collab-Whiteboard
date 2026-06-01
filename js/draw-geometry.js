// Two barb endpoints for an arrowhead at (x,y), pointing along the
// segment from (startX,startY). `len` is the barb length in world units.
export function arrowHeadPoints(startX, startY, x, y, len) {
  const angle = Math.atan2(y - startY, x - startX);
  const spread = Math.PI / 7; // ~26° half-angle between the two barbs
  return [
    { x: x - len * Math.cos(angle - spread), y: y - len * Math.sin(angle - spread) },
    { x: x - len * Math.cos(angle + spread), y: y - len * Math.sin(angle + spread) },
  ];
}

// Vertices for a bbox-based polygon shape. bbox is normalized {x,y,width,height}.
export function polygonPoints(tool, bbox) {
  const { x, y, width: w, height: h } = bbox;
  if (tool === 'diamond') {
    return [
      { x: x + w / 2, y },
      { x: x + w,     y: y + h / 2 },
      { x: x + w / 2, y: y + h },
      { x,            y: y + h / 2 },
    ];
  }
  if (tool === 'triangle') {
    return [
      { x,            y: y + h },
      { x: x + w,     y: y + h },
      { x: x + w / 2, y },
    ];
  }
  return [];
}

// Ray-casting point-in-polygon.
export function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    const intersects = (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Base dash pattern (world units) for a stroke style. Callers divide each
// value by viewport.zoom before passing to ctx.setLineDash().
export function dashPattern(style) {
  if (style === 'dashed') return [8, 6];
  if (style === 'dotted') return [2, 6];
  return [];
}
