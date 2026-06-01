# Output Encoding & XSS Defense Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the confirmed `shape.tool` HTML-injection sink, harden every shape-render path with one centralized validator, and unify the three drifting `escapeHtml` helpers so attribute-context output is quote-safe.

**Architecture:** Untrusted data (peer-authored CRDT shapes in open rooms, localStorage board history) reaches `innerHTML` in `js/drawing.js` and `js/boards-home.js`. Rather than patch each interpolation, we add small **pure, unit-testable allowlist/escape helpers to `js/utils.js`** and a `sanitizeShape()` validator, then route the render sites through them. This makes the fix testable in Vitest (the DOM render functions themselves are not).

**Tech Stack:** Vanilla ES modules, Vitest, Web Crypto. Tests live in `tests/*.test.js` and run with `npm test`.

Project Hub tasks covered: **701** (Task 1), **702** (Task 2), **703** (Task 3).

---

### Task 1: Allowlist `shape.tool` before it reaches `innerHTML` (Hub #701, HIGH)

**Files:**
- Modify: `js/utils.js` (add `safeToolName`)
- Modify: `js/drawing.js:2` (import) and `js/drawing.js:1137-1139` (use it)
- Test: `tests/safe-color.test.js` (extend — it already covers `safeColor`/`safeNumber`)

- [ ] **Step 1: Write the failing test**

Append to `tests/safe-color.test.js`:

```js
import { safeToolName } from '../js/utils.js';

describe('safeToolName', () => {
  it('passes through every known drawing tool unchanged', () => {
    for (const t of ['line', 'rect', 'circle', 'text', 'freehand', 'eraser']) {
      expect(safeToolName(t)).toBe(t);
    }
  });

  it('collapses an HTML-injection payload to the safe literal "shape"', () => {
    expect(safeToolName('<img src=x onerror=alert(1)>')).toBe('shape');
    expect(safeToolName('<style>body{}</style>')).toBe('shape');
  });

  it('collapses non-strings and unknown values to "shape"', () => {
    expect(safeToolName(null)).toBe('shape');
    expect(safeToolName(undefined)).toBe('shape');
    expect(safeToolName(42)).toBe('shape');
    expect(safeToolName('bogus')).toBe('shape');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- safe-color`
Expected: FAIL — `safeToolName is not a function` / import is undefined.

- [ ] **Step 3: Add the helper to `js/utils.js`**

Insert directly after `safeNumber` (after line 56):

```js
// Allowlist of tool names the app actually produces. shape.tool arrives from
// untrusted peers via the shared CRDT and is interpolated into innerHTML when
// building the shape-settings popup header, so any value outside this set
// collapses to the inert literal 'shape'. Mirrors safeColor/safeNumber.
const KNOWN_TOOLS = ['line', 'rect', 'circle', 'text', 'freehand', 'eraser'];

export function safeToolName(value) {
  return typeof value === 'string' && KNOWN_TOOLS.includes(value) ? value : 'shape';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- safe-color`
Expected: PASS (all `safeToolName` cases green).

- [ ] **Step 5: Wire it into `js/drawing.js`**

Change the import on line 2 from:

```js
import { generateId, safeColor, safeNumber } from './utils.js';
```

to:

```js
import { generateId, safeColor, safeNumber, safeToolName } from './utils.js';
```

Replace lines 1136-1139 (the `headerText` block):

```js
  // Dynamic header based on shape type
  const headerText = isText ? 'Text Settings' :
    shape.tool === 'freehand' ? 'Freehand Settings' :
    shape.tool.charAt(0).toUpperCase() + shape.tool.slice(1) + ' Settings';
```

with:

```js
  // Dynamic header based on shape type. shape.tool is peer-controlled and lands
  // in popup.innerHTML below, so allowlist it before building the label.
  const safeTool = safeToolName(shape.tool);
  const headerText = safeTool === 'text' ? 'Text Settings' :
    safeTool === 'freehand' ? 'Freehand Settings' :
    safeTool.charAt(0).toUpperCase() + safeTool.slice(1) + ' Settings';
```

- [ ] **Step 6: Run the full suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS (existing suites + new `safeToolName` cases).

- [ ] **Step 7: Commit**

```bash
git add js/utils.js js/drawing.js tests/safe-color.test.js
git commit -m "security: allowlist shape.tool before innerHTML (XSS fix)"
```

---

### Task 2: Centralized `sanitizeShape()` validator at the render boundary (Hub #702, MEDIUM)

**Files:**
- Create: `js/shape-schema.js`
- Modify: `js/drawing.js` (use `sanitizeShape` in `showShapeSettingsPopup` instead of per-field sanitizing)
- Test: `tests/shape-schema.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/shape-schema.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { sanitizeShape } from '../js/shape-schema.js';

describe('sanitizeShape', () => {
  it('returns null for non-objects', () => {
    expect(sanitizeShape(null)).toBeNull();
    expect(sanitizeShape('x')).toBeNull();
  });

  it('neutralizes an injected tool and clamps numeric/color fields', () => {
    const dirty = {
      tool: '<img src=x onerror=alert(1)>',
      color: 'javascript:alert(1)',
      strokeWidth: 'NaN',
      fontSize: {},
      x: 10, y: 20,
    };
    const clean = sanitizeShape(dirty);
    expect(clean.tool).toBe('shape');
    expect(clean.color).toBe('#000000');     // safeColor fallback
    expect(clean.strokeWidth).toBe(2);       // safeNumber fallback
    expect(clean.fontSize).toBe(20);         // safeNumber fallback
    expect(clean.x).toBe(10);                // untouched geometry preserved
  });

  it('passes a well-formed shape through with values intact', () => {
    const ok = { tool: 'rect', color: '#ff0000', strokeWidth: 5, fontSize: 16 };
    const clean = sanitizeShape(ok);
    expect(clean).toMatchObject({ tool: 'rect', color: '#ff0000', strokeWidth: 5, fontSize: 16 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- shape-schema`
Expected: FAIL — cannot resolve `../js/shape-schema.js`.

- [ ] **Step 3: Create the validator**

Create `js/shape-schema.js`:

```js
import { safeColor, safeNumber, safeToolName } from './utils.js';

// Normalize an untrusted shape pulled from the shared CRDT into one whose
// DOM-bound fields are safe to interpolate. Non-DOM fields (geometry, text —
// text is rendered via canvas fillText, not HTML) are preserved as-is. Returns
// null for non-objects so callers can skip them.
export function sanitizeShape(shape) {
  if (!shape || typeof shape !== 'object') return null;
  return {
    ...shape,
    tool: safeToolName(shape.tool),
    color: safeColor(shape.color),
    fillColor: shape.fillColor ? safeColor(shape.fillColor) : shape.fillColor,
    strokeWidth: safeNumber(shape.strokeWidth, 2),
    fontSize: safeNumber(shape.fontSize, 20),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- shape-schema`
Expected: PASS.

- [ ] **Step 5: Use it in `showShapeSettingsPopup` (DRY the per-field calls)**

In `js/drawing.js`, add to the import on line 2:

```js
import { sanitizeShape } from './shape-schema.js';
```

At the very top of `showShapeSettingsPopup`, before the `hasStroke`/`isText` computation (around line 1131), normalize once:

```js
  // Normalize the untrusted CRDT shape once; all DOM-bound fields below are now
  // safe. (Replaces the scattered safeColor/safeNumber/safeToolName calls.)
  shape = sanitizeShape(shape) || shape;
```

Then simplify lines 1147-1150 (now redundant) to read directly from the normalized object:

```js
  const strokeColor = shape.color;
  const strokeWidth = shape.strokeWidth;
  const fillColor = shape.fillColor || '#ffffff';
  const fontSize = shape.fontSize;
```

Leave the `safeTool` line from Task 1 as-is (it now receives an already-clean tool, which is harmless and keeps Task 1 independently correct).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add js/shape-schema.js js/drawing.js tests/shape-schema.test.js
git commit -m "security: centralize untrusted shape validation at render boundary"
```

---

### Task 3: Unify `escapeHtml` and quote-escape `roomId` attributes in boards-home (Hub #703, LOW)

**Files:**
- Modify: `js/utils.js` (export a shared, quote-safe `escapeHtml`)
- Modify: `js/boards-home.js` (drop the local helper; escape `board.roomId` in all three attribute sites)
- Test: `tests/safe-color.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/safe-color.test.js`:

```js
import { escapeHtml } from '../js/utils.js';

describe('escapeHtml (shared, attribute-safe)', () => {
  it('escapes angle brackets, ampersand, and BOTH quote styles', () => {
    expect(escapeHtml('<a>&"\'')).toBe('&lt;a&gt;&amp;&quot;&#39;');
  });

  it('coerces non-strings without throwing', () => {
    expect(escapeHtml(123)).toBe('123');
    expect(escapeHtml(null)).toBe('null');
  });

  it('prevents attribute breakout', () => {
    // value used as data-room-id="<here>" must not be able to close the attribute
    expect(escapeHtml('x" onmouseover="alert(1)')).not.toContain('"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- safe-color`
Expected: FAIL — `escapeHtml is not a function`.

- [ ] **Step 3: Add the shared helper to `js/utils.js`**

Append to `js/utils.js`:

```js
// Single source of truth for HTML escaping. Escapes the five characters that
// matter in both text and attribute contexts (modal.js and awareness.js had
// their own copies; boards-home.js had one MISSING the quotes — that drift is
// why this lives here now). Coerces non-strings so callers can pass anything.
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- safe-color`
Expected: PASS.

- [ ] **Step 5: Replace the local helper in `js/boards-home.js`**

Add to the existing import block at the top (lines 1-8):

```js
    import { escapeHtml } from '/js/utils.js';
```

Delete the local `escapeHtml` definition (lines 151-155):

```js
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
```

Escape `board.roomId` at all three attribute sites. Line 65:

```js
          <div class="board-card" data-room-id="${escapeHtml(board.roomId)}">
```

Line 97:

```js
              <button class="btn btn-danger btn-remove" data-room-id="${escapeHtml(board.roomId)}" title="Remove from history">
```

Line 103:

```js
              <a href="/room/${escapeHtml(board.roomId)}${board.isEncrypted ? '' : ''}" class="btn btn-primary">
```

(The `${escapeHtml(board.roomName || board.roomId)}` on line 75 already uses the helper — now upgraded to the quote-safe version automatically.)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: (Optional, same commit) De-duplicate the other two copies**

`js/modal.js` and `js/awareness.js` define their own `escapeHtml`. If you want to fully close the drift now: replace each local definition with `import { escapeHtml } from './utils.js';`. Run `npm test` again and confirm the awareness/modal suites stay green. Skip if you prefer a focused diff.

- [ ] **Step 8: Commit**

```bash
git add js/utils.js js/boards-home.js tests/safe-color.test.js
git commit -m "security: unify escapeHtml (quote-safe) and escape roomId attributes"
```

---

## Self-Review

- **Spec coverage:** #701 → Task 1; #702 → Task 2; #703 → Task 3. All three covered.
- **Type consistency:** `safeToolName` defined in Task 1 is reused by `sanitizeShape` in Task 2 and the drawing import — same name throughout. `escapeHtml(value)` signature is consistent between the helper and all call sites.
- **No placeholders:** every code/edit step shows the full code and exact line targets.
- **Risk note:** Task 2 Step 5 reassigns the local `shape` parameter; confirm `showShapeSettingsPopup` does not later rely on the original (un-normalized) object reference for identity comparison — it reads fields only, so this is safe. If a future reader prefers immutability, assign to a new `const s = sanitizeShape(shape) || shape;` and update references.
