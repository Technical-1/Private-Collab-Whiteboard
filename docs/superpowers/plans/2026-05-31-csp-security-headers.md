# CSP & Security Headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing `base-uri`/`form-action` CSP directives (closes the base-tag amplification of any HTML injection), then remove `'unsafe-inline'` from `style-src` so a `<style>` injection can no longer execute even if a new sink appears.

**Architecture:** CSP is served as a static header in `vercel.json`. There is no unit-test seam for a JSON header, so these tasks use **edit + grep/curl verification** rather than Vitest. Task 5 first audits where inline styles are actually used (the reason `'unsafe-inline'` is currently required), converts them to scripted `element.style` / CSS classes, then drops the directive.

**Tech Stack:** Vercel static hosting, `vercel.json` headers block.

Project Hub tasks covered: **704** (Task 1), **705** (Task 2).

Current CSP (`vercel.json:15`):
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' wss://*.partykit.dev; img-src 'self' data: blob:; frame-ancestors 'none'
```

---

### Task 1: Add `base-uri 'none'` and `form-action 'self'` (Hub #704, MEDIUM — release-gating, trivial)

**Files:**
- Modify: `vercel.json:15` (the `Content-Security-Policy` value)

- [ ] **Step 1: Confirm the directives are currently absent**

Run: `grep -o "base-uri[^;\"]*\|form-action[^;\"]*" vercel.json`
Expected: no output (neither directive present).

- [ ] **Step 2: Edit the CSP value**

In `vercel.json`, replace the `Content-Security-Policy` value string with (note the two appended directives at the end):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' wss://*.partykit.dev; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
```

- [ ] **Step 3: Verify the JSON is still valid and contains both directives**

Run: `node -e "const c=require('./vercel.json'); const csp=c.headers[0].headers.find(h=>h.key==='Content-Security-Policy').value; if(!/base-uri 'none'/.test(csp)||!/form-action 'self'/.test(csp)) throw new Error('missing directive'); console.log('OK:', csp)"`
Expected: prints `OK:` followed by the full policy. No throw = valid JSON + both directives present.

- [ ] **Step 4: Build to confirm nothing in the app depends on a `<base>` tag**

Run: `npm run build`
Expected: build succeeds. (The app uses absolute `/js/...` and `/room/...` paths, so `base-uri 'none'` has no functional effect — it only blocks injected `<base>` tags.)

- [ ] **Step 5: Commit**

```bash
git add vercel.json
git commit -m "security: add base-uri 'none' and form-action 'self' to CSP"
```

- [ ] **Step 6: Post-deploy verification (manual, after Vercel deploys)**

Run: `curl -sI https://<deployed-host>/ | grep -i content-security-policy`
Expected: the response header includes `base-uri 'none'; form-action 'self'`.

---

### Task 2: Remove `'unsafe-inline'` from `style-src` (Hub #705, LOW — hardening)

> This task is larger than Task 1: `'unsafe-inline'` is in `style-src` because generated HTML and templates use inline `style="..."`/`<style>`. We must remove every inline-style dependency first, or the UI breaks. Do the audit (Step 1) before editing the CSP.

**Files:**
- Modify: various `js/*.js` and `*.html` (wherever inline styles are produced — discovered in Step 1)
- Modify: `vercel.json:15` (remove `'unsafe-inline'` from `style-src`)

- [ ] **Step 1: Audit every inline-style source**

Run:
```bash
grep -rn "style=\"" *.html js/ ; echo "--- <style> blocks ---" ; grep -rn "<style" *.html js/ ; echo "--- scripted cssText ---" ; grep -rn "\.style\.cssText\|setAttribute('style'\|setAttribute(\"style\"" js/
```
Expected: a list of inline-style sites. **Record each one** — this is the work surface. Note: `element.style.prop = value` assignments are NOT affected by `style-src` (only literal `style="..."` attributes and inline `<style>` blocks are), so you can ignore those.

- [ ] **Step 2: Convert each literal inline style to a class or scripted assignment**

For each `style="..."` in generated HTML strings, move the declarations into `css/styles.css` under a new class and swap the markup to use `class="..."`. For dynamic values (e.g. a per-user color), set them after insertion via JS:

```js
// BEFORE (requires 'unsafe-inline'):
el.innerHTML = `<span style="color:${safeColor(user.color)}">${escapeHtml(user.name)}</span>`;

// AFTER (CSP-clean): no style attribute in the markup...
el.innerHTML = `<span class="user-name">${escapeHtml(user.name)}</span>`;
// ...set the dynamic property by script (style-src does not govern this):
el.querySelector('.user-name').style.color = safeColor(user.color);
```

Repeat for every site from Step 1. Inline `<style>` blocks in `*.html` move into linked `css/styles.css`.

- [ ] **Step 3: Run the app and verify nothing is visually broken**

Run: `npm run dev` and load `/`, `/room/<id>`, and `/boards.html`. Confirm colors, cursors, layout, and the shape-settings popup render correctly. (Use the `run` skill / browser to screenshot if available.)
Expected: identical appearance to before.

- [ ] **Step 4: Remove `'unsafe-inline'` from the CSP**

In `vercel.json:15`, change `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` to:

```
style-src 'self' https://fonts.googleapis.com
```

- [ ] **Step 5: Verify and build**

Run: `node -e "const c=require('./vercel.json'); const csp=c.headers[0].headers.find(h=>h.key==='Content-Security-Policy').value; if(/style-src[^;]*unsafe-inline/.test(csp)) throw new Error('unsafe-inline still present'); console.log('OK')" && npm run build`
Expected: prints `OK` and build succeeds.

- [ ] **Step 6: Re-run the dev server and confirm no CSP violations in the console**

Run: `npm run dev`, open DevTools console on each page.
Expected: zero `Refused to apply inline style because it violates CSP` errors. If any appear, return to Step 2 for the offending element.

- [ ] **Step 7: Commit**

```bash
git add vercel.json css/styles.css js/ *.html
git commit -m "security: drop 'unsafe-inline' from style-src (move inline styles to CSS/JS)"
```

---

## Self-Review

- **Spec coverage:** #704 → Task 1; #705 → Task 2.
- **Ordering:** Task 1 is independent and shippable immediately. Task 2 depends on the Step 1 audit and must not edit the CSP before the inline styles are gone, or pages break — the steps enforce that order.
- **No placeholders:** Task 1 is fully concrete. Task 2 Step 1/2 are discovery-driven by design (the inline-style sites aren't known until grepped); the conversion pattern is shown in full and the verification gates (Steps 3, 6) catch any miss.
- **Verification seam:** no Vitest (JSON header has no unit seam); each task uses a concrete `node -e` assertion + build + (Task 2) a manual no-violation check.
