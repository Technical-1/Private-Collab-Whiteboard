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
   * @param {{load():Promise<Uint8Array|null>, save(bytes:Uint8Array):Promise<void>}|null} store - optional persistence store
   */
  constructor(doc, transport, capability, privateKey, publicKey, store = null) {
    this.doc = doc;
    this.transport = transport;
    this.epoch = capability.epoch;
    this.isEditor = capability.role === 'edit' && !!privateKey;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.store = store;
    this._pending = Promise.resolve(); // serializes async sign/verify work (test hook)
    this._latestSnapshot = null; // { payload: Uint8Array } cached editor-signed SNAPSHOT
    this._snapshotTimer = null;

    transport.onMessage = (type, payload) => this._receive(type, payload);

    // Broadcast local editor edits (origin !== REMOTE_ORIGIN means it's ours).
    this._updateHandler = (update, origin) => {
      if (origin === REMOTE_ORIGIN) return;
      if (!this.isEditor) return; // viewers never broadcast doc updates
      this._enqueue(async () => {
        const sig = await signUpdate(this.privateKey, update, this.epoch);
        this.transport.send(MSG.UPDATE, encodeEnvelope(update, this.epoch, sig));
      });
      this._scheduleSnapshot();
    };
    doc.on('update', this._updateHandler);
  }

  async start() {
    // Load any persisted snapshot first, then ask the room for current state.
    if (this.store) {
      const saved = await this.store.load();
      if (saved) await this._applySnapshot(saved);
    }
    this.transport.send(MSG.SNAPSHOT_REQUEST, new Uint8Array(0));
  }

  _enqueue(fn) { this._pending = this._pending.then(fn).catch((e) => console.error(e)); }

  _receive(type, payload) {
    if (type === MSG.UPDATE) this._enqueue(() => this._applySigned(payload));
    else if (type === MSG.SNAPSHOT) this._enqueue(() => this._applySnapshot(payload));
    else if (type === MSG.SNAPSHOT_REQUEST) this._enqueue(() => this._answerSnapshotRequest());
  }

  async _applySigned(payload) {
    let env;
    try { env = decodeEnvelope(payload); } catch { return; }
    if (env.epoch !== this.epoch) return;                       // wrong epoch -> drop
    const ok = await verifyUpdate(this.publicKey, env.update, env.epoch, env.sig);
    if (!ok) return;                                            // bad sig -> drop
    Y.applyUpdate(this.doc, env.update, REMOTE_ORIGIN);
  }

  _scheduleSnapshot() {
    if (!this.isEditor) return;
    if (this._snapshotTimer) return;
    this._snapshotTimer = setTimeout(() => {
      this._snapshotTimer = null;
      this._enqueue(() => this.emitSnapshot());
    }, 1000);
  }

  /** Editor: sign a full-state snapshot, cache it, broadcast it. */
  async emitSnapshot() {
    if (!this.isEditor) return;
    const state = Y.encodeStateAsUpdate(this.doc);
    const sig = await signUpdate(this.privateKey, state, this.epoch);
    const payload = encodeEnvelope(state, this.epoch, sig);
    this._latestSnapshot = { payload };
    if (this.store) this._enqueue(() => this.store.save(payload));
    this.transport.send(MSG.SNAPSHOT, payload);
  }

  async _applySnapshot(payload) {
    let env;
    try { env = decodeEnvelope(payload); } catch { return; }
    if (env.epoch !== this.epoch) return;
    const ok = await verifyUpdate(this.publicKey, env.update, env.epoch, env.sig);
    if (!ok) return;
    // Cache verified snapshot so we can relay it later (even viewers).
    this._latestSnapshot = { payload };
    if (this.store) this._enqueue(() => this.store.save(payload));
    Y.applyUpdate(this.doc, env.update, REMOTE_ORIGIN);
  }

  async _answerSnapshotRequest() {
    // Editors produce a fresh snapshot; anyone with a cached one relays it.
    if (this.isEditor) { await this.emitSnapshot(); return; }
    if (this._latestSnapshot) this.transport.send(MSG.SNAPSHOT, this._latestSnapshot.payload);
  }

  destroy() {
    if (this._snapshotTimer) { clearTimeout(this._snapshotTimer); this._snapshotTimer = null; }
    this.doc.off('update', this._updateHandler);
  }

  // ----- test hooks -----
  async _flush() { await this._pending; }
  async _drain() { await this._pending; }
}
