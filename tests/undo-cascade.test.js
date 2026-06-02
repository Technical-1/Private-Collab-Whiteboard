import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { danglingConnectorIndices } from '../js/connector-geometry.js';

function setup() {
  const doc = new Y.Doc();
  const boards = doc.getMap('boards');
  const board = new Y.Array();
  boards.set('default', board);
  board.push([
    { id: 'a', tool: 'rect', startX: 0, startY: 0, width: 10, height: 10 },
    { id: 'b', tool: 'rect', startX: 50, startY: 0, width: 10, height: 10 },
    { id: 'c', tool: 'connector', fromId: 'a', toId: 'b', fromAnchor: 'e', toAnchor: 'w' },
  ]);
  const um = new Y.UndoManager([boards], { captureTimeout: 500 });
  return { doc, board, um };
}

// Mirror the app's deleteShape+removeDanglingConnectors sequence, wrapped in one transaction.
function deleteWithCascade(doc, board, id) {
  doc.transact(() => {
    const idx = board.toArray().findIndex(s => s.id === id);
    if (idx !== -1) board.delete(idx, 1);
    for (const i of danglingConnectorIndices(board.toArray())) board.delete(i, 1);
  });
}

describe('connector cascade delete is undo-symmetric', () => {
  it('deleting an endpoint removes its connector, and undo restores BOTH in one step', () => {
    const { doc, board, um } = setup();
    deleteWithCascade(doc, board, 'a');
    let ids = board.toArray().map(s => s.id);
    expect(ids).toEqual(['b']); // 'a' and dangling connector 'c' both gone

    um.undo();
    ids = board.toArray().map(s => s.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']); // single undo restored the endpoint AND the connector
  });
});

// Mirror deleteSelectedShapes wrapping the per-id deletes in ONE transaction.
function deleteManyInOneStep(doc, board, ids) {
  doc.transact(() => {
    for (const id of ids) {
      const idx = board.toArray().findIndex(s => s.id === id);
      if (idx !== -1) board.delete(idx, 1);
    }
  });
}

// Extended setup: seeds a,b,c (from setup) plus d,e BEFORE the UndoManager is
// created, so the initial state is not tracked and undo only covers the delete.
function setupFive() {
  const doc = new Y.Doc();
  const boards = doc.getMap('boards');
  const board = new Y.Array();
  boards.set('default', board);
  board.push([
    { id: 'a', tool: 'rect', startX: 0, startY: 0, width: 10, height: 10 },
    { id: 'b', tool: 'rect', startX: 50, startY: 0, width: 10, height: 10 },
    { id: 'c', tool: 'connector', fromId: 'a', toId: 'b', fromAnchor: 'e', toAnchor: 'w' },
    { id: 'd', tool: 'rect', startX: 0, startY: 40, width: 10, height: 10 },
    { id: 'e', tool: 'rect', startX: 40, startY: 40, width: 10, height: 10 },
  ]);
  const um = new Y.UndoManager([boards], { captureTimeout: 500 });
  return { doc, board, um };
}

describe('multi-select delete is one undo step', () => {
  it('deleting three shapes is reversed by a single undo', () => {
    const { doc, board, um } = setupFive();
    deleteManyInOneStep(doc, board, ['a', 'd', 'e']);
    expect(board.toArray().map(s => s.id).sort()).toEqual(['b', 'c']);

    um.undo();
    expect(board.toArray().map(s => s.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
