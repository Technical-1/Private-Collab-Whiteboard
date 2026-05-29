import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { signData, verifyData } from './crypto.js';

// Wire message types (1-byte prefix on the transport).
export const MSG = {
  UPDATE: 0,
  SNAPSHOT: 1,
  SNAPSHOT_REQUEST: 2,
  AWARENESS: 3,
};

/**
 * Build the wire envelope: epoch ‖ update ‖ sig. The sig is the transport
 * wrapper, NOT part of the signed message — the signed bytes are epoch ‖ update
 * only (see signedBytes / signUpdate).
 * @param {Uint8Array} update
 * @param {number} epoch
 * @param {Uint8Array} sig - 64-byte Ed25519 signature
 * @returns {Uint8Array}
 */
export function encodeEnvelope(update, epoch, sig) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, epoch);
  encoding.writeVarUint8Array(enc, update);
  encoding.writeVarUint8Array(enc, sig);
  return encoding.toUint8Array(enc);
}

/**
 * Parse a signed payload.
 * @param {Uint8Array} bytes
 * @returns {{ epoch: number, update: Uint8Array, sig: Uint8Array }}
 */
export function decodeEnvelope(bytes) {
  const dec = decoding.createDecoder(bytes);
  const epoch = decoding.readVarUint(dec);
  const update = decoding.readVarUint8Array(dec);
  const sig = decoding.readVarUint8Array(dec);
  return { epoch, update, sig };
}

// The signed message is the update bytes prefixed by the epoch, so a signature
// from one epoch can't be replayed as another.
function signedBytes(update, epoch) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, epoch);
  encoding.writeVarUint8Array(enc, update);
  return encoding.toUint8Array(enc);
}

/** Sign an update for a given epoch. @returns {Promise<Uint8Array>} */
export async function signUpdate(privateKey, update, epoch) {
  return signData(privateKey, signedBytes(update, epoch));
}

/** Verify a signed update for a given epoch. @returns {Promise<boolean>} */
export async function verifyUpdate(publicKey, update, epoch, sig) {
  return verifyData(publicKey, signedBytes(update, epoch), sig);
}
