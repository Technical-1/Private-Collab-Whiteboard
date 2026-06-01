import { describe, it, expect } from 'vitest';
import { isLocalHost } from '../js/sync-provider.js';

describe('isLocalHost', () => {
  it('is true only for canonical loopback hosts', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('0.0.0.0')).toBe(true);
  });

  it('is false for dotless non-loopback names (no ws:// downgrade)', () => {
    expect(isLocalHost('evil')).toBe(false);
    expect(isLocalHost('intranet')).toBe(false);
    expect(isLocalHost('myhost')).toBe(false);
  });

  it('is false for real domains', () => {
    expect(isLocalHost('whiteboard-collab.technical-1.partykit.dev')).toBe(false);
  });
});
