/**
 * headingIds.ts
 *
 * Note: We no longer use MutationObserver to update heading ids dynamically.
 *
 * The original design modified ProseMirror-managed DOM nodes via `el.id = slug`, which caused:
 *   assignIds → el.id changes → ProseMirror detects a heading attribute change
 *   → replaces the heading node → childList mutation contains a heading → affectsHeadings=true
 *   → calls assignIds again → infinite loop (B087)
 *
 * The click handler in index.ts already has a built-in slug-scan fallback,
 * so heading scroll positioning works correctly without relying on el.id.
 * This module therefore keeps the exported signature (so index.ts can still call it) but does not touch the DOM.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initHeadingIds(_container: HTMLElement): void {
    // Intentionally no DOM operation — see the comment above
}
