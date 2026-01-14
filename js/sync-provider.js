/**
 * Unified Y.js sync provider for PartyKit
 *
 * Works with a simple broadcast server and supports optional encryption.
 * Uses the y-protocols sync protocol which handles all sync logic client-side.
 */

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export class SyncProvider {
  /**
   * @param {string} serverUrl - PartyKit server URL
   * @param {string} roomId - Room identifier
   * @param {Y.Doc} ydoc - Y.js document
   * @param {Object} options - Configuration options
   * @param {CryptoKey|null} options.encryptionKey - Optional AES-GCM key for E2E encryption
   * @param {Function} options.onStatus - Status callback
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

    this._synced = false;
    this._resyncInterval = null;

    // Callbacks
    this._onStatus = options.onStatus || (() => {});

    // Bind methods
    this._onMessage = this._onMessage.bind(this);
    this._onClose = this._onClose.bind(this);
    this._onOpen = this._onOpen.bind(this);

    // Y.js update handler - broadcast to other clients
    this._updateHandler = (update, origin) => {
      if (origin !== this) {
        this._broadcastUpdate(update);
      }
    };
    ydoc.on('update', this._updateHandler);

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

  get synced() {
    return this._synced;
  }

  get isEncrypted() {
    return !!this.encryptionKey;
  }

  connect() {
    if (this.wsconnecting || this.wsconnected) return;

    this.wsconnecting = true;
    this._onStatus({ status: 'connecting' });

    // Build WebSocket URL
    const protocol = this.serverUrl.startsWith('localhost') ? 'ws' : 'wss';
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

    if (this._resyncInterval) {
      clearInterval(this._resyncInterval);
    }

    if (typeof window !== 'undefined' && this._beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
    }

    this.doc.off('update', this._updateHandler);
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

    // Send sync step 1 (our state vector)
    await this._sendSyncStep1();

    // Send our current awareness state
    this._broadcastAwareness([this.doc.clientID]);

    // Periodic resync to ensure consistency
    this._resyncInterval = setInterval(() => {
      if (this.wsconnected) {
        this._sendSyncStep1();
      }
    }, 30000);
  }

  async _onMessage(event) {
    try {
      let data = new Uint8Array(event.data);
      if (data.length < 2) return;

      const messageType = data[0];
      let payload = data.slice(1);

      // Decrypt if encrypted mode
      if (this.isEncrypted && this.decrypt) {
        try {
          payload = await this.decrypt(payload, this.encryptionKey);
        } catch (err) {
          console.error('Decryption failed:', err);
          this._onStatus({ status: 'decryption-failed' });
          return;
        }
      }

      if (messageType === MESSAGE_SYNC) {
        await this._handleSyncMessage(payload);
      } else if (messageType === MESSAGE_AWARENESS) {
        this._handleAwarenessMessage(payload);
      }
    } catch (error) {
      console.error('Failed to process message:', error);
    }
  }

  async _handleSyncMessage(payload) {
    const decoder = decoding.createDecoder(payload);
    const encoder = encoding.createEncoder();

    const syncMessageType = syncProtocol.readSyncMessage(
      decoder,
      encoder,
      this.doc,
      this
    );

    // If there's a response to send (sync step 2), send it
    if (encoding.length(encoder) > 0) {
      await this._sendMessage(MESSAGE_SYNC, encoding.toUint8Array(encoder));
    }

    // Mark as synced after receiving sync step 2 or update
    if (syncMessageType === syncProtocol.messageYjsSyncStep2 ||
        syncMessageType === syncProtocol.messageYjsUpdate) {
      if (!this._synced) {
        this._synced = true;
        this._onStatus({ status: 'synced' });
      }
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
    this._synced = false;

    this._onStatus({ status: 'disconnected' });

    // Reconnect with exponential backoff
    this.wsUnsuccessfulReconnects++;
    const backoff = Math.min(
      Math.pow(2, this.wsUnsuccessfulReconnects) * 100,
      this.maxBackoffTime
    );

    setTimeout(() => this.connect(), backoff);
  }

  async _sendSyncStep1() {
    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoder, this.doc);
    await this._sendMessage(MESSAGE_SYNC, encoding.toUint8Array(encoder));
  }

  async _broadcastUpdate(update) {
    if (!this.wsconnected) return;

    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    await this._sendMessage(MESSAGE_SYNC, encoding.toUint8Array(encoder));
  }

  async _broadcastAwareness(changedClients) {
    if (!this.wsconnected) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
    );
    await this._sendMessage(MESSAGE_AWARENESS, encoding.toUint8Array(encoder));
  }

  async _sendMessage(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      let finalPayload = payload;

      // Encrypt if in encrypted mode
      if (this.isEncrypted && this.encrypt) {
        finalPayload = await this.encrypt(payload, this.encryptionKey);
      }

      // Prepend message type
      const message = new Uint8Array(1 + finalPayload.length);
      message[0] = type;
      message.set(finalPayload, 1);

      this.ws.send(message);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }
}
