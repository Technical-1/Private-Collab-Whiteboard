import { describe, it, expect } from 'vitest';
import { wrapText } from '../js/text-wrap.js';

const measure = (s) => s.length * 10; // 10px per char, deterministic

describe('wrapText', () => {
  it('returns a single line when it fits', () => {
    expect(wrapText(measure, 'hello', 100)).toEqual(['hello']);
  });
  it('wraps on spaces when the line exceeds maxWidth', () => {
    expect(wrapText(measure, 'aaaaa bbbbb', 100)).toEqual(['aaaaa', 'bbbbb']);
  });
  it('hard-breaks a single word longer than maxWidth', () => {
    expect(wrapText(measure, 'abcdefghijkl', 50)).toEqual(['abcde', 'fghij', 'kl']);
  });
  it('returns [] for empty/nullish text', () => {
    expect(wrapText(measure, '', 100)).toEqual([]);
    expect(wrapText(measure, null, 100)).toEqual([]);
  });
});
