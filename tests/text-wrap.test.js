import { describe, it, expect } from 'vitest';
import { wrapText, wrapMultiline } from '../js/text-wrap.js';

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
  it('pushes a single char wider than maxWidth as-is (no infinite loop)', () => {
    // 1 char = 10px, maxWidth 5: the `chunk.length > 1` guard must prevent spinning
    expect(wrapText(measure, 'x', 5)).toEqual(['x']);
  });
  it('merges a hard-break remainder with the next word when it fits', () => {
    // "abcdefg hi" @60: hard-break -> "abcdef" + remainder "g"; then "g hi" (40) <= 60
    expect(wrapText(measure, 'abcdefg hi', 60)).toEqual(['abcdef', 'g hi']);
  });
});

describe('wrapMultiline', () => {
  // A measure() where every char is 1 unit wide.
  const measure = (s) => s.length;

  it('keeps explicit newlines as separate lines', () => {
    expect(wrapMultiline(measure, 'a\nb\nc', 100)).toEqual(['a', 'b', 'c']);
  });
  it('wraps each segment by width and preserves blank lines', () => {
    // maxWidth 3: "aaaa" hard-breaks; blank line between stays.
    expect(wrapMultiline(measure, 'aaaa\n\nbb', 3)).toEqual(['aaa', 'a', '', 'bb']);
  });
  it('single line with no newline behaves like wrapText', () => {
    expect(wrapMultiline(measure, 'hello world', 100)).toEqual(['hello world']);
  });
  it('non-string input returns []', () => {
    expect(wrapMultiline(measure, null, 100)).toEqual([]);
  });
});
