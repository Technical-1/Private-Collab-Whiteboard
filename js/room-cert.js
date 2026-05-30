import { importPrivateKey, importPublicKey, signStatement, verifyStatement } from './crypto.js';

/**
 * Owner mints a certificate binding an editor public key to an epoch.
 * @param {string} skOB64 - owner private key (base64 PKCS8)
 * @param {string} pkOB64 - owner public key (base64 raw) = room identity
 * @param {number} epoch
 * @param {string} editorPubB64 - editor public key (base64 raw)
 * @returns {Promise<{e:number, ep:string, sig:string}>}
 */
export async function mintCert(skOB64, pkOB64, epoch, editorPubB64) {
  const skO = await importPrivateKey(skOB64);
  const sig = await signStatement(skO, { room: pkOB64, epoch, editorPub: editorPubB64 });
  return { e: epoch, ep: editorPubB64, sig };
}

/**
 * Verify a cert against the owner public key. Returns the bound {epoch, editorPub}
 * or null if missing/malformed/not-owner-signed/tampered. Never throws.
 * @param {string} pkOB64 - owner public key the verifier trusts (from its link)
 * @param {{e:number, ep:string, sig:string}} cert
 * @returns {Promise<{epoch:number, editorPub:string}|null>}
 */
export async function verifyCert(pkOB64, cert) {
  if (!cert || typeof cert.e !== 'number' || typeof cert.ep !== 'string' || typeof cert.sig !== 'string') {
    return null;
  }
  try {
    const pkO = await importPublicKey(pkOB64);
    const ok = await verifyStatement(pkO, { room: pkOB64, epoch: cert.e, editorPub: cert.ep }, cert.sig);
    return ok ? { epoch: cert.e, editorPub: cert.ep } : null;
  } catch {
    return null;
  }
}
