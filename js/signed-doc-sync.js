import * as Y from 'yjs';
import { MSG, encodeEnvelope, decodeEnvelope, signUpdate, verifyUpdate } from './protocol.js';

const REMOTE_ORIGIN = Symbol('signed-doc-sync-remote');
const EMPTY_SIG = new Uint8Array(0); // placeholder signature for open (unsigned) rooms

/**
 * Binds a Y.Doc to a transport.
 *
 * Two modes:
 * - Signed (capability room): a room verify key is provided. Only editor-signed,
 *   current-epoch updates/snapshots are ever applied; viewers cannot author.
 * - Open (passwordless room): no public key. Updates are exchanged UNSIGNED and
 *   applied without verification — open collaboration, everyone is an editor.
 *   There is no view-only enforcement and no confidentiality in this mode, which
 *   matches the app's original password-free room behavior.
 */
export class SignedDocSync {
  /**
   * @param {Y.Doc} doc
   * @param {{send:(type:number,payload:Uint8Array)=>void, onMessage:Function|null}} transport
   * @param {{role:'edit'|'view', epoch:number}} capability
   * @param {CryptoKey|null} privateKey - editor signing key (null for viewers/open rooms)
   * @param {CryptoKey|null} publicKey - room verify key; null => open (unsigned) room
   * @param {{load():Promise<Uint8Array|null>, save(bytes:Uint8Array):Promise<void>}|null} store - optional persistence store
   */
  constructor(doc, transport, capability, privateKey, publicKey, store = null) {
    this.doc = doc;
    this.transport = transport;
    this.epoch = capability.epoch;
    // Signed mode iff we have a verify key. Open rooms run unsigned.
    this.signed = !!publicKey;
    // In open rooms everyone can author; in signed rooms only the key holder.
    this.isEditor = !this.signed || (capability.role === 'edit' && !!privateKey);
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.store = store;
    this._pending = Promise.resolve(); // serializes async sign/verify work (test hook)
    this._latestSnapshot = null; // { payload: Uint8Array } cached editor-signed SNAPSHOT
    this._snapshotTimer = null;
    this._bootstrapTimer = null;
    this._applied = false; // set once any remote state has been applied

    transport.onMessage = (type, payload) => this._receive(type, payload);
    // Re-ask the room for state whenever the socket (re)connects. start()'s
    // initial request is usually dropped because the WS isn't OPEN yet, so this
    // hook is what actually bootstraps a fresh joiner.
    transport.onConnect = () => this._requestSnapshot();

    // Broadcast local editor edits (origin !== REMOTE_ORIGIN means it's ours).
    this._updateHandler = (update, origin) => {
      if (origin === REMOTE_ORIGIN) return;
      if (!this.isEditor) return; // viewers never broadcast doc updates
      this._enqueue(async () => {
        const sig = this.signed
          ? await signUpdate(this.privateKey, update, this.epoch)
          : EMPTY_SIG;
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
    this._requestSnapshot();
    // A single request can race a just-connecting peer (the responder may not
    // have us in the room yet), leaving a fresh joiner to an idle room empty.
    // Retry a few times until we've applied some state. Snapshots are idempotent.
    let tries = 0;
    this._bootstrapTimer = setInterval(() => {
      if (this._applied || ++tries >= 5) {
        clearInterval(this._bootstrapTimer);
        this._bootstrapTimer = null;
        return;
      }
      this._requestSnapshot();
    }, 1500);
  }

  /** Ask peers for the current signed state (bootstrap). */
  _requestSnapshot() {
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
    if (this.signed) {
      const ok = await verifyUpdate(this.publicKey, env.update, env.epoch, env.sig);
      if (!ok) return;                                          // bad sig -> drop
    }
    Y.applyUpdate(this.doc, env.update, REMOTE_ORIGIN);
    this._applied = true;
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
    const sig = this.signed ? await signUpdate(this.privateKey, state, this.epoch) : EMPTY_SIG;
    const payload = encodeEnvelope(state, this.epoch, sig);
    this._latestSnapshot = { payload };
    if (this.store) this._enqueue(() => this.store.save(payload));
    this.transport.send(MSG.SNAPSHOT, payload);
  }

  async _applySnapshot(payload) {
    let env;
    try { env = decodeEnvelope(payload); } catch { return; }
    if (env.epoch !== this.epoch) return;
    if (this.signed) {
      const ok = await verifyUpdate(this.publicKey, env.update, env.epoch, env.sig);
      if (!ok) return;
    }
    // Cache verified snapshot so we can relay it later (even viewers).
    this._latestSnapshot = { payload };
    if (this.store) this._enqueue(() => this.store.save(payload));
    Y.applyUpdate(this.doc, env.update, REMOTE_ORIGIN);
    this._applied = true;
  }

  async _answerSnapshotRequest() {
    // Editors produce a fresh snapshot; anyone with a cached one relays it.
    if (this.isEditor) { await this.emitSnapshot(); return; }
    if (this._latestSnapshot) this.transport.send(MSG.SNAPSHOT, this._latestSnapshot.payload);
  }

  destroy() {
    if (this._snapshotTimer) { clearTimeout(this._snapshotTimer); this._snapshotTimer = null; }
    if (this._bootstrapTimer) { clearInterval(this._bootstrapTimer); this._bootstrapTimer = null; }
    this.doc.off('update', this._updateHandler);
  }

  // ----- test hooks -----
  async _flush() { await this._pending; }
  async _drain() { await this._pending; }
}
