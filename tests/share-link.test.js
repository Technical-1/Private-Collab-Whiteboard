import { describe, it, expect, afterEach } from 'vitest';
import { mintRoomCapability, encodeCapabilityHash, decodeCapabilityToken, getShareableLink } from '../js/room-manager.js';

function stubWindow(hash) {
  globalThis.window = { location: { origin: 'https://wb.example', pathname: '/room/abc', hash } };
}
afterEach(() => { delete globalThis.window; });

describe('getShareableLink (v3)', () => {
  it('embeds a VIEW capability for an encrypted room (no private keys leaked)', async () => {
    const cap = await mintRoomCapability('pw');
    stubWindow('#' + encodeCapabilityHash(cap, 'owner'));
    const link = getShareableLink('view');
    expect(link).toContain('#');
    const dec = decodeCapabilityToken(link.split('#')[1]);
    expect(dec.role).toBe('view');
    expect(dec.skO).toBeNull();
    expect(dec.skE).toBeNull();
  });

  it('shares an EDIT (never owner) link for permission=edit', async () => {
    const cap = await mintRoomCapability('pw');
    stubWindow('#' + encodeCapabilityHash(cap, 'owner'));
    const dec = decodeCapabilityToken(getShareableLink('edit').split('#')[1]);
    expect(dec.role).toBe('edit');
    expect(dec.skO).toBeNull();   // owner authority NEVER shared
    expect(dec.skE).toBeTruthy();
  });

  it('returns a bare URL for an open room', async () => {
    stubWindow('');
    expect(getShareableLink('view')).toBe('https://wb.example/room/abc');
  });
});
