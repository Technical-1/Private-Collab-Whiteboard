import type * as Party from "partykit/server";

/**
 * Simple WebSocket broadcast server for the whiteboard.
 *
 * This server just relays messages between connected clients.
 * All Y.js sync logic happens on the client side.
 *
 * Works for both:
 * - Unencrypted rooms (y-partykit protocol)
 * - Encrypted rooms (our custom encrypted protocol)
 */
export default class WhiteboardServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    // When a new client connects, send them all messages from other clients
    // This triggers sync on the client side
    console.log(`Client ${conn.id} connected to room ${this.room.id}`);
  }

  onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
    // Broadcast message to all OTHER clients in the room
    // The sender already has this data, so we don't echo back
    for (const conn of this.room.getConnections()) {
      if (conn.id !== sender.id) {
        conn.send(message);
      }
    }
  }

  onClose(conn: Party.Connection) {
    console.log(`Client ${conn.id} disconnected from room ${this.room.id}`);
  }
}
