import { describe, it, expect } from 'vitest';
import { mintRoomCapability, capabilityRole } from '../js/room-manager.js';

describe('room capability minting', () => {
  it('mints an editor capability with a fresh keypair', async () => {
    const cap = await mintRoomCapability('pw');
    expect(cap.role).toBe('edit');
    expect(cap.epoch).toBe(1);
    expect(cap.privateKeyB64).toBeTruthy();
    expect(cap.publicKeyB64).toBeTruthy();
    expect(cap.password).toBe('pw');
  });

  it('capabilityRole reads the role', async () => {
    const cap = await mintRoomCapability('pw');
    expect(capabilityRole(cap)).toBe('edit');
    expect(capabilityRole({ role: 'view' })).toBe('view');
    expect(capabilityRole(null)).toBe('view');
  });
});
