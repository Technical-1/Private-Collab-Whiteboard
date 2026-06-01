// Greedy word wrap. `measure(str)` returns the rendered pixel width of str.
// Words longer than maxWidth are hard-broken character-by-character.
// Note: hard newlines are treated as ordinary whitespace (split on /\s+/), so
// callers that need to preserve `\n` must split on it and call wrapText per line.
// (The sticky-note editor is a single-line <input>, so notes carry no newlines.)
export function wrapText(measure, text, maxWidth) {
  if (!text || typeof text !== 'string') return [];
  const lines = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let chunk = word;
    while (measure(chunk) > maxWidth && chunk.length > 1) {
      let i = 1;
      while (i < chunk.length && measure(chunk.slice(0, i + 1)) <= maxWidth) i++;
      lines.push(chunk.slice(0, i));
      chunk = chunk.slice(i);
    }
    const last = lines.length - 1;
    if (last >= 0 && measure(`${lines[last]} ${chunk}`) <= maxWidth) {
      lines[last] = `${lines[last]} ${chunk}`;
    } else {
      lines.push(chunk);
    }
  }
  return lines;
}
