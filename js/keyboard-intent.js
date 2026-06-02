// Pure decision for whether a Delete/Backspace keypress should consume the event
// and delete the selection. Kept separate from app.js so it is unit-testable and
// so preventDefault is never called for a no-op (which would swallow the key).
export function shouldDeleteSelection({ readOnly, selectionCount }) {
  return !readOnly && selectionCount > 0;
}
