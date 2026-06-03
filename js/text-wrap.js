// Greedy word wrap. `measure(str)` returns the rendered pixel width of str.
// Words longer than maxWidth are hard-broken character-by-character.
// Note: hard newlines are treated as ordinary whitespace (split on /\s+/), so
// callers that need to preserve `\n` must split on it and call wrapText per line.
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

// Like wrapText, but newline-aware: splits on '\n' first, wraps each segment,
// and preserves blank lines (an empty segment yields one empty line). Used by
// sticky notes, which are now multi-line.
export function wrapMultiline(measure, text, maxWidth) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  for (const segment of text.split('\n')) {
    if (segment === '') { out.push(''); continue; }
    const wrapped = wrapText(measure, segment, maxWidth);
    if (wrapped.length === 0) out.push('');
    else out.push(...wrapped);
  }
  return out;
}

/**
 * Returns the maximum scrollable pixels for a sticky note's text area.
 * When the wrapped text fits within innerHeight, returns 0 (no scroll needed).
 * When content overflows, returns the positive excess in pixels.
 *
 * @param {number} lineCount   - number of wrapped lines
 * @param {number} lineStep    - vertical distance per line in pixels (fs * 1.3)
 * @param {number} innerHeight - available height for text (height - pad*2)
 * @returns {number} max scroll offset in pixels (>= 0)
 */
export function stickyMaxScroll(lineCount, lineStep, innerHeight) {
  return Math.max(0, lineCount * lineStep - innerHeight);
}
