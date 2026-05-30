/**
 * Typed transport layer for the collaborative whiteboard.
 *
 * Owns: WebSocket lifecycle (connect/disconnect/destroy), reconnect/backoff,
 *       AES encrypt/decrypt, and AWARENESS handling (unsigned, ephemeral).
 *
 * Does NOT own: Y.js document sync (y-protocols). A separate signing/sync
 *               layer calls `send(type, payload)` and receives decoded payloads
 *               via the `onMessage` callback.
 */

import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { MSG } from './protocol.js';

export class SyncProvider {
  /**
   * @param {string} serverUrl - PartyKit server URL
   * @param {string} roomId - Room identifier
   * @param {import('yjs').Doc} ydoc - Y.js document (used only for awareness)
   * @param {Object} options - Configuration options
   * @param {CryptoKey|null} options.encryptionKey - Optional AES-GCM key for E2E encryption
   * @param {Function} options.onStatus - Status callback
   * @param {Function} options.onMessage - Called with (type:number, payload:Uint8Array) for non-awareness messages
   * @param {Function} options.encrypt - Encryption function (if encryptionKey provided)
   * @param {Function} options.decrypt - Decryption function (if encryptionKey provided)
   */
  constructor(serverUrl, roomId, ydoc, options = {}) {
    this.serverUrl = serverUrl;
    this.roomId = roomId;
    this.doc = ydoc;
    this.encryptionKey = options.encryptionKey || null;
    this.encrypt = options.encrypt || null;
    this.decrypt = options.decrypt || null;
    this.awareness = new awarenessProtocol.Awareness(ydoc);

    this.wsconnected = false;
    this.wsconnecting = false;
    this.ws = null;
    this.wsUnsuccessfulReconnects = 0;
    this.maxBackoffTime = 2500;

    // Callbacks. onMessage/onConnect are PUBLIC settable properties: the signing
    // layer (SignedDocSync) assigns them after construction, so they must not be
    // private fields read only from constructor options.
    this._onStatus = options.onStatus || (() => {});
    this.onMessage = options.onMessage || null;
    // Invoked on every (re)connect so the signing layer can re-ask for state
    // once the socket is actually OPEN.
    this.onConnect = options.onConnect || null;

    // Bind methods
    this._onMessage = this._onMessage.bind(this);
    this._onClose = this._onClose.bind(this);
    this._onOpen = this._onOpen.bind(this);

    // Awareness change handler
    this._awarenessUpdateHandler = ({ added, updated, removed }, origin) => {
      if (origin !== this) {
        const changedClients = added.concat(updated).concat(removed);
        this._broadcastAwareness(changedClients);
      }
    };
    this.awareness.on('update', this._awarenessUpdateHandler);

    // Start connection
    this.connect();

    // Cleanup on page unload
    this._beforeUnloadHandler = () => {
      // Remove our awareness state before disconnecting
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [this.doc.clientID],
        'window unload'
      );
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this._beforeUnloadHandler);
    }
  }

  get isEncrypted() {
    return !!this.encryptionKey;
  }

  connect() {
    if (this.wsconnecting || this.wsconnected) return;

    this.wsconnecting = true;
    this._onStatus({ status: 'connecting' });

    // Build WebSocket URL. Use insecure ws:// only for local dev hosts;
    // everything else (real domains) must use wss://.
    const host = this.serverUrl.split(':')[0];
    const isLocal =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      !host.includes('.');
    const protocol = isLocal ? 'ws' : 'wss';
    const wsUrl = `${protocol}://${this.serverUrl}/party/${this.roomId}`;

    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = this._onOpen;
    this.ws.onmessage = this._onMessage;
    this.ws.onclose = this._onClose;
    this.ws.onerror = (e) => console.error('WebSocket error:', e);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  destroy() {
    this.disconnect();

    if (typeof window !== 'undefined' && this._beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
    }

    this.awareness.off('update', this._awarenessUpdateHandler);
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [this.doc.clientID],
      this
    );
  }

  async _onOpen() {
    this.wsconnecting = false;
    this.wsconnected = true;
    this.wsUnsuccessfulReconnects = 0;

    this._onStatus({ status: 'connected' });

    // Send our current awareness state
    this._broadcastAwareness([this.doc.clientID]);

    // Let the signing layer (re)bootstrap now that the socket is OPEN.
    if (this.onConnect) this.onConnect();
  }

  async _onMessage(event) {
    try {
      const data = new Uint8Array(event.data);
      if (data.length < 1) return;
      const type = data[0];
      let payload = data.slice(1);

      if (type === MSG.AWARENESS) {
        // Awareness is never encrypted/signed (ephemeral, cosmetic).
        this._handleAwarenessMessage(payload);
        return;
      }

      // All other types carry an AES-encrypted signed envelope.
      if (this.isEncrypted && this.decrypt) {
        try {
          payload = await this.decrypt(payload, this.encryptionKey);
        } catch (err) {
          // Drop the frame. In the capability model the password lives in the
          // link, so an undecryptable frame is an incompatible peer (e.g. someone
          // who opened the bare room URL, or a pre-rotation client) — NOT the
          // local user's "wrong password". Surfacing it would wrongly nuke a
          // working session, so we ignore it rather than emit decryption-failed.
          console.debug('Dropping undecryptable frame from an incompatible peer');
          return;
        }
      }
      if (this.onMessage) this.onMessage(type, payload);
    } catch (error) {
      console.error('Failed to process message:', error);
    }
  }

  _handleAwarenessMessage(payload) {
    try {
      const decoder = decoding.createDecoder(payload);
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(decoder),
        this
      );
    } catch (error) {
      console.error('Failed to apply awareness update:', error);
    }
  }

  _onClose() {
    this.wsconnected = false;
    this.wsconnecting = false;

    this._onStatus({ status: 'disconnected' });

    // Reconnect with exponential backoff
    this.wsUnsuccessfulReconnects++;
    const backoff = Math.min(
      Math.pow(2, this.wsUnsuccessfulReconnects) * 100,
      this.maxBackoffTime
    );

    setTimeout(() => this.connect(), backoff);
  }

  async _broadcastAwareness(changedClients) {
    if (!this.wsconnected) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
    );
    await this.send(MSG.AWARENESS, encoding.toUint8Array(encoder));
  }

  /**
   * Send a typed message. Awareness messages are sent unencrypted; all other
   * types are AES-encrypted when an encryptionKey is configured.
   * @param {number} type - Message type (use MSG constants from protocol.js)
   * @param {Uint8Array} payload
   */
  async send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      let finalPayload = payload;
      if (type !== MSG.AWARENESS && this.isEncrypted && this.encrypt) {
        finalPayload = await this.encrypt(payload, this.encryptionKey);
      }
      const message = new Uint8Array(1 + finalPayload.length);
      message[0] = type;
      message.set(finalPayload, 1);
      this.ws.send(message);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }
}
