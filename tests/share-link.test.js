import { describe, it, expect, afterEach } from 'vitest';
import { encodeEditorLink, decodeCapabilityToken, getShareableLink } from '../js/room-manager.js';

function stubWindow(hash) {
  globalThis.window = { location: { origin: 'https://wb.example', pathname: '/room/abc', hash } };
}
afterEach(() => { delete globalThis.window; });

describe('getShareableLink for capability (encrypted) rooms', () => {
  // Regression: a "view only" link for an encrypted room must carry the
  // capability (password + public key). Previously, with includePassword=false
  // it returned a bare URL, so the recipient dropped into an open/editable room
  // on the same id and corrupted the original with decryption errors.
  it('embeds a VIEW capability even when includePassword is false', () => {
    stubWindow('#' + encodeEditorLink('pw', 'PRIVKEY', 'PUBKEY', 1));
    const link = getShareableLink(false, 'view');
    expect(link).toContain('#'); // not a bare URL
    const cap = decodeCapabilityToken(link.split('#')[1]);
    expect(cap).not.toBeNull();
    expect(cap.role).toBe('view');
    expect(cap.password).toBe('pw');
    expect(cap.publicKeyB64).toBe('PUBKEY');
    expect(cap.privateKeyB64).toBeNull(); // view link must NOT leak the signing key
  });

  it('embeds an EDIT capability for an edit link', () => {
    stubWindow('#' + encodeEditorLink('pw', 'PRIVKEY', 'PUBKEY', 1));
    const cap = decodeCapabilityToken(getShareableLink(false, 'edit').split('#')[1]);
    expect(cap.role).toBe('edit');
    expect(cap.privateKeyB64).toBe('PRIVKEY');
  });

  it('returns a bare URL for an open (unencrypted) room', () => {
    stubWindow(''); // no capability in URL
    expect(getShareableLink(false, 'view')).toBe('https://wb.example/room/abc');
  });
});
