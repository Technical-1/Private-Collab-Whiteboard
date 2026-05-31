import { describe, it, expect } from 'vitest';
import { safeColor, safeNumber } from '../js/utils.js';

// safeColor is the XSS boundary for color values that get interpolated into
// innerHTML (user presence colors in awareness.js, shape colors in the
// drawing.js settings popup). Colors arrive from untrusted peers over unsigned
// awareness / the shared CRDT doc, so anything that isn't a strict hex color
// must be replaced with a safe fallback — there is no legitimate non-hex color
// in this app (palette + <input type=color> both emit #rrggbb).

describe('safeColor', () => {
  it('passes through a standard #rrggbb color unchanged', () => {
    expect(safeColor('#3182BD')).toBe('#3182BD');
  });

  it('accepts 3-, 4-, 6-, and 8-digit hex forms', () => {
    expect(safeColor('#abc')).toBe('#abc');
    expect(safeColor('#abcd')).toBe('#abcd');
    expect(safeColor('#aabbcc')).toBe('#aabbcc');
    expect(safeColor('#aabbccdd')).toBe('#aabbccdd');
  });

  it('rejects the renderUsers attribute-breakout XSS payload', () => {
    const poc = 'red"></span><img src=x onerror=alert(document.domain)><span "';
    expect(safeColor(poc)).toBe('#000000');
  });

  it('rejects the shape-popup value-attribute breakout XSS payload', () => {
    const poc = '"><img src=x onerror=alert(document.domain)>';
    expect(safeColor(poc)).toBe('#000000');
  });

  it('rejects rgb()/rgba() and named colors (hex-only by design)', () => {
    expect(safeColor('rgb(255,0,0)')).toBe('#000000');
    expect(safeColor('red')).toBe('#000000');
  });

  it('rejects malformed hex (wrong length, non-hex chars)', () => {
    expect(safeColor('#12')).toBe('#000000');
    expect(safeColor('#12345')).toBe('#000000');
    expect(safeColor('#gggggg')).toBe('#000000');
    expect(safeColor('#aabbcc ')).toBe('#000000');
  });

  it('rejects non-string input (null, undefined, number, object)', () => {
    expect(safeColor(null)).toBe('#000000');
    expect(safeColor(undefined)).toBe('#000000');
    expect(safeColor(0xff0000)).toBe('#000000');
    expect(safeColor({})).toBe('#000000');
  });

  it('honors a caller-supplied fallback', () => {
    expect(safeColor('not-a-color', '#ffffff')).toBe('#ffffff');
  });
});

// safeNumber guards numeric shape fields (strokeWidth, fontSize) that are
// interpolated into value="..." attributes in the shape-settings popup. A
// remote peer can set these to arbitrary strings, so a non-finite value must
// collapse to a safe number rather than reach innerHTML.
describe('safeNumber', () => {
  it('passes through a finite number', () => {
    expect(safeNumber(5, 2)).toBe(5);
  });

  it('coerces a numeric string', () => {
    expect(safeNumber('20', 2)).toBe(20);
  });

  it('rejects an attribute-breakout XSS payload', () => {
    expect(safeNumber('"><img src=x onerror=alert(1)>', 2)).toBe(2);
  });

  it('rejects trailing-unit strings like "20px"', () => {
    expect(safeNumber('20px', 2)).toBe(2);
  });

  it('rejects NaN, null, undefined, and objects', () => {
    expect(safeNumber(NaN, 2)).toBe(2);
    expect(safeNumber(null, 2)).toBe(2);
    expect(safeNumber(undefined, 2)).toBe(2);
    expect(safeNumber({}, 2)).toBe(2);
  });
});
