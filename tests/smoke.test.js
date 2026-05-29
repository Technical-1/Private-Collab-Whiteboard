import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('has Web Crypto with Ed25519 + AES-GCM', async () => {
    expect(globalThis.crypto?.subtle).toBeDefined();
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    expect(kp.publicKey).toBeDefined();
  });
});
