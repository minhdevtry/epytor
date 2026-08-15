import "./pathLink.css";
import { notifyOpenFile } from "@/messaging";

// ── Path detection regex ──────────────────────────────────────────────────────
// Matches: @/path, ./path, ../path, dir/file, file.ext
const PATH_REGEX =
    /^(@\/[^\s]+|\.{1,2}\/[^\s]+|[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/[^\s]+|[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.[a-zA-Z][a-zA-Z0-9]*(#\d+(-\d+)?)?)$/;

function isPathLike(text: string): boolean {
    return PATH_REGEX.test(text.trim());
}

// Decide whether a <code> element should respond to path jumps:
//   Exclude pre > code (code blocks), <a> > code (already a link), and content that doesn't look like a path
function isEligibleCode(el: Element): boolean {
    if (el.tagName !== "CODE") return false;
    if (el.closest("pre")) return false;
    if (el.closest("a")) return false;
    return isPathLike(el.textContent ?? "");
}

export function setupPathLink(container: HTMLElement): void {
    const isMac = window.__i18n?.isMac ?? false;

    let cmdHeld = false;
    let activeCode: Element | null = null;
    let lastHoveredCode: Element | null = null;

    function highlight(el: Element): void {
        if (activeCode === el) return;
        unhighlight();
        activeCode = el;
        el.classList.add("path-link--active");
    }

    function unhighlight(): void {
        if (!activeCode) return;
        activeCode.classList.remove("path-link--active");
        activeCode = null;
    }

    // ── Modifier-key tracking ──────────────────────────────────────────────────
    document.addEventListener("keydown", (e) => {
        if (isMac ? e.key === "Meta" : e.key === "Control") {
            cmdHeld = true;
            // Scenario: Cmd pressed first, then hover — the mouse is already on the target, highlight immediately
            if (lastHoveredCode && isEligibleCode(lastHoveredCode)) {
                highlight(lastHoveredCode);
            }
        }
    });

    document.addEventListener("keyup", (e) => {
        if (isMac ? e.key === "Meta" : e.key === "Control") {
            cmdHeld = false;
            unhighlight();
        }
    });

    // Cmd+Tab away won't fire keyup; reset via blur
    window.addEventListener("blur", () => {
        cmdHeld = false;
        unhighlight();
    });

    // ── Mouse hover ────────────────────────────────────────────────────
    container.addEventListener("mouseover", (e) => {
        const code = (e.target as Element).closest("code");
        if (code && isEligibleCode(code)) {
            lastHoveredCode = code;
            if (cmdHeld) highlight(code);
        } else {
            lastHoveredCode = null;
            unhighlight();
        }
    });

    container.addEventListener("mouseout", (e) => {
        const related = e.relatedTarget as Node | null;
        // If the mouse is still inside activeCode (e.g. moving to a child node), don't clear the highlight
        if (activeCode && related && activeCode.contains(related)) return;
        lastHoveredCode = null;
        if (cmdHeld) unhighlight();
    });

    // ── Cmd+Click ────────────────────────────────────────────────────
    container.addEventListener("click", (e) => {
        const me = e as MouseEvent;
        if (!me.metaKey && !me.ctrlKey) return;

        const code = (me.target as Element).closest("code");
        if (!code || !isEligibleCode(code)) return;

        e.preventDefault();
        e.stopPropagation();
        const path = (code.textContent ?? "").trim();
        notifyOpenFile(path);
        unhighlight();
    });
}
