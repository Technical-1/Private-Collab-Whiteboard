import { describe, it, expect } from 'vitest';
import { safeToolName } from '../js/utils.js';

describe('safeToolName allowlist — Phase 1 tools', () => {
  for (const tool of ['arrow', 'diamond', 'triangle', 'ellipse']) {
    it(`passes through "${tool}"`, () => {
      expect(safeToolName(tool)).toBe(tool);
    });
  }
  it('still neutralizes unknown/injected names', () => {
    expect(safeToolName('<img src=x onerror=alert(1)>')).toBe('shape');
  });
});
