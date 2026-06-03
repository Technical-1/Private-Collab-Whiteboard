import { describe, it, expect } from 'vitest';
import { shouldDeleteSelection } from '../js/keyboard-intent.js';

describe('shouldDeleteSelection', () => {
  it('true only when editable and something is selected', () => {
    expect(shouldDeleteSelection({ readOnly: false, selectionCount: 2 })).toBe(true);
  });
  it('false in read-only mode even with a selection', () => {
    expect(shouldDeleteSelection({ readOnly: true, selectionCount: 2 })).toBe(false);
  });
  it('false when nothing is selected', () => {
    expect(shouldDeleteSelection({ readOnly: false, selectionCount: 0 })).toBe(false);
  });
});
