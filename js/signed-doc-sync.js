import * as Y from 'yjs';
import { MSG, encodeEnvelope, decodeEnvelope, signUpdate, verifyUpdate } from './protocol.js';

const REMOTE_ORIGIN = Symbol('signed-doc-sync-remote');

/**
 * Binds a Y.Doc to a transport with editor-signed updates.
 * Only editor-signed, current-epoch updates are ever applied.
 */
export class SignedDocSync {
  /**
   * @param {Y.Doc} doc
   * @param {{send:(type:number,payload:Uint8Array)=>void, onMessage:Function|null}} transport
   * @param {{role:'edit'|'view', epoch:number}} capability
   * @param {CryptoKey|null} privateKey - editor signing key (null for viewers)
   * @param {CryptoKey} publicKey - room verify key (from the link)
   */
  constructor(doc, transport, capability, privateKey, publicKey) {
    this.doc = doc;
    this.transport = transport;
    this.epoch = capability.epoch;
    this.isEditor = capability.role === 'edit' && !!privateKey;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this._pending = Promise.resolve(); // serializes async sign/verify work (test hook)

    transport.onMessage = (type, payload) => this._receive(type, payload);

    // Broadcast local editor edits (origin !== REMOTE_ORIGIN means it's ours).
    this._updateHandler = (update, origin) => {
      if (origin === REMOTE_ORIGIN) return;
      if (!this.isEditor) return; // viewers never broadcast doc updates
      this._enqueue(async () => {
        const sig = await signUpdate(this.privateKey, update, this.epoch);
        this.transport.send(MSG.UPDATE, encodeEnvelope(update, this.epoch, sig));
      });
    };
    doc.on('update', this._updateHandler);
  }

  async start() { /* snapshot/bootstrap added in a later task */ }

  _enqueue(fn) { this._pending = this._pending.then(fn).catch((e) => console.error(e)); }

  _receive(type, payload) {
    if (type === MSG.UPDATE) this._enqueue(() => this._applySigned(payload));
    // SNAPSHOT / SNAPSHOT_REQUEST handled in a later task
  }

  async _applySigned(payload) {
    let env;
    try { env = decodeEnvelope(payload); } catch { return; }
    if (env.epoch !== this.epoch) return;                       // wrong epoch -> drop
    const ok = await verifyUpdate(this.publicKey, env.update, env.epoch, env.sig);
    if (!ok) return;                                            // bad sig -> drop
    Y.applyUpdate(this.doc, env.update, REMOTE_ORIGIN);
  }

  destroy() { this.doc.off('update', this._updateHandler); }

  // ----- test hooks -----
  async _flush() { await this._pending; }
  async _drain() { await this._pending; }
}
