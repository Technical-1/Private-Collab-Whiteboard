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
