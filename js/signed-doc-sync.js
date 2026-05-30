import * as Y from 'yjs';
import { MSG, encodeEnvelope, decodeEnvelope, signUpdate, verifyUpdate, encodeRotateNotice, decodeRotateNotice } from './protocol.js';
import { verifyCert } from './room-cert.js';
import { signStatement, verifyStatement } from './crypto.js';

const REMOTE_ORIGIN = Symbol('signed-doc-sync-remote');
const EMPTY_SIG = new Uint8Array(0); // placeholder signature for open (unsigned) rooms

/**
 * Binds a Y.Doc to a transport.
 *
 * Two modes:
 * - Signed (capability room): an editorVerifyKey is provided. Only editor-signed,
 *   current-epoch updates/snapshots whose cert is valid are ever applied; viewers
 *   cannot author.
 * - Open (passwordless room): signed=false. Updates are exchanged UNSIGNED and
 *   applied without verification — open collaboration, everyone is an editor.
 *   There is no view-only enforcement and no confidentiality in this mode, which
 *   matches the app's original password-free room behavior.
 *
 * @param {Y.Doc} doc
 * @param {{send:(type:number,payload:Uint8Array)=>void, onMessage:Function|null}} transport
 * @param {object} o - options:
 *   signed        {boolean}       - true for capability rooms
 *   epoch         {number}        - current epoch number
 *   isEditor      {boolean}       - can this peer author updates?
 *   isOwner       {boolean}       - can this peer rotate the room?
 *   editorSignKey {CryptoKey|null}- ECDSA private key for signing (editors only)
 *   editorVerifyKey {CryptoKey|null} - ECDSA public key to verify editor updates
 *   ownerVerifyKey {CryptoKey|null}  - ECDSA public key of the room owner
 *   ownerSignKey  {CryptoKey|null}   - ECDSA private key of owner (owner only)
 *   ownerPubB64   {string|null}      - base64 owner public key (for cert verification)
 *   cert          {object|null}      - epoch certificate from owner
 *   store         {object|null}      - optional {load, save} persistence store
 */
export class SignedDocSync {
  constructor(doc, transport, o) {
    this.doc = doc;
    this.transport = transport;
    this.signed = !!o.signed;
    this.epoch = o.epoch;
    this.isEditor = !this.signed || !!o.isEditor;
    this.isOwner = !!o.isOwner;
    this.editorSignKey = o.editorSignKey || null;
    this.editorVerifyKey = o.editorVerifyKey || null;
    this.editorPubB64 = o.editorPubB64 || null; // base64 of editorVerifyKey, to pin against the cert
    this.ownerVerifyKey = o.ownerVerifyKey || null;
    this.ownerSignKey = o.ownerSignKey || null;
    this.ownerPubB64 = o.ownerPubB64 || null;
    this.cert = o.cert || null;
    this.store = o.store || null;

    this._pending = Promise.resolve(); // serializes async sign/verify work (test hook)
    this._latestSnapshot = null; // { payload: Uint8Array } cached editor-signed SNAPSHOT
    this._snapshotTimer = null;
    this._bootstrapTimer = null;
    this._applied = false; // set once any remote state has been applied
    this._superseded = false; // set on epoch rotation
    this._certOk = false; // set in start() after cert verification
    this.onRotated = null; // set by the app to surface owner rotation

    transport.onMessage = (type, payload) => this._receive(type, payload);
    // Re-ask the room for state whenever the socket (re)connects. start()'s
    // initial request is usually dropped because the WS isn't OPEN yet, so this
    // hook is what actually bootstraps a fresh joiner.
    transport.onConnect = () => this._requestSnapshot();

    // Broadcast local editor edits (origin !== REMOTE_ORIGIN means it's ours).
    this._updateHandler = (update, origin) => {
      if (origin === REMOTE_ORIGIN) return;
      if (!this.isEditor || this._superseded) return; // viewers never broadcast doc updates
      this._enqueue(async () => {
        const sig = this.signed
          ? await signUpdate(this.editorSignKey, update, this.epoch)
          : EMPTY_SIG;
        this.transport.send(MSG.UPDATE, encodeEnvelope(update, this.epoch, sig));
      });
      this._scheduleSnapshot();
    };
    doc.on('update', this._updateHandler);
  }

  async start() {
    // Verify the room cert once: must be owner-signed and authorize exactly our
    // editor verify key for our epoch. Otherwise the room is untrusted -> apply
    // nothing (fail closed). Open rooms have no cert and are fine.
    if (this.signed) {
      // The cert must be owner-signed, for our epoch, AND bind exactly the
      // editor key we verify updates against — otherwise the cert isn't pinning
      // anything. Fail closed if any check fails.
      const bound = this.cert ? await verifyCert(this.ownerPubB64, this.cert) : null;
      this._certOk = !!bound && bound.epoch === this.epoch && bound.editorPub === this.editorPubB64;
    } else {
      this._certOk = true;
    }

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
    else if (type === MSG.ROTATE) this._enqueue(() => this._handleRotate(payload));
  }

  async _applySigned(payload) {
    if (this._superseded) return;                               // epoch rotated away -> drop
    let env;
    try { env = decodeEnvelope(payload); } catch { return; }
    if (env.epoch !== this.epoch) return;                       // wrong epoch -> drop
    if (this.signed) {
      if (!this._certOk) return;                               // untrusted room -> drop
      const ok = await verifyUpdate(this.editorVerifyKey, env.update, env.epoch, env.sig);
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
    const sig = this.signed ? await signUpdate(this.editorSignKey, state, this.epoch) : EMPTY_SIG;
    const payload = encodeEnvelope(state, this.epoch, sig);
    this._latestSnapshot = { payload };
    if (this.store) this._enqueue(() => this.store.save(payload));
    this.transport.send(MSG.SNAPSHOT, payload);
  }

  async _applySnapshot(payload) {
    if (this._superseded) return;                               // epoch rotated away -> drop
    let env;
    try { env = decodeEnvelope(payload); } catch { return; }
    if (env.epoch !== this.epoch) return;
    if (this.signed) {
      if (!this._certOk) return;                               // untrusted room -> drop
      const ok = await verifyUpdate(this.editorVerifyKey, env.update, env.epoch, env.sig);
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

  /**
   * Owner only: announce that the room has rotated to a new epoch. Only the
   * owner holds ownerSignKey, so editors cannot produce a notice peers accept.
   */
  async broadcastRotate(toEpoch) {
    if (!this.isOwner || !this.ownerSignKey) return;
    const notice = { type: 'rotate', room: this.ownerPubB64, from: this.epoch, to: toEpoch };
    const sig = await signStatement(this.ownerSignKey, notice);
    this.transport.send(MSG.ROTATE, encodeRotateNotice(notice, sig));
  }

  async _handleRotate(payload) {
    if (!this.signed || !this.ownerVerifyKey) return;
    let parsed;
    try { parsed = decodeRotateNotice(payload); } catch { return; }
    const notice = parsed && parsed.notice;
    const sig = parsed && parsed.sig;
    if (!notice || notice.type !== 'rotate' || notice.room !== this.ownerPubB64) return;
    if (notice.from !== this.epoch) return;                 // not about our epoch
    const ok = await verifyStatement(this.ownerVerifyKey, notice, sig);
    if (!ok) return;                                        // not owner-signed -> ignore
    this._superseded = true;                                // stop applying old-epoch edits
    if (this.onRotated) this.onRotated(notice.to);
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
