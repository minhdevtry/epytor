import './toc.css';
import type { EditorView } from "@milkdown/kit/prose/view";
import { DEFAULT_TOPBAR_HEIGHT, VIEWPORT_PADDING } from "../../../shared/constants";
import { applyTooltip } from "@/ui/tooltip";
import { t } from "@/i18n";
import { IconPin, IconChevronRight, IconChevronDown, IconChevronsUp, IconChevronsDown } from "@/ui/icons";
import { getWebviewState, setWebviewState } from "@/messaging";

interface HeadingEntry {
    level: number;
    text: string;
    pos: number;
}

const TOC_WIDTH = 200;
const TOC_MIN_WIDTH = 200;
const TOC_MAX_WIDTH = 500;

/** Extract all heading nodes from the EditorView */
function getHeadings(view: EditorView): HeadingEntry[] {
    const headings: HeadingEntry[] = [];
    view.state.doc.nodesBetween(0, view.state.doc.content.size, (node, pos) => {
        if (node.type.name === "heading") {
            headings.push({ level: node.attrs["level"] as number, text: node.textContent, pos });
        }
    });
    return headings;
}

/** Find the corresponding heading DOM element by the heading's position in the document */
function findHeadingElement(view: EditorView, pos: number): HTMLElement | null {
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (dom?.matches("h1,h2,h3,h4,h5,h6")) return dom;
    const { node } = view.domAtPos(pos + 1);
    let el: HTMLElement | null =
        node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
    while (el && !el.matches("h1,h2,h3,h4,h5,h6")) el = el.parentElement;
    return el;
}

function hasChildren(headings: HeadingEntry[], index: number): boolean {
    if (index >= headings.length - 1) return false;
    return headings[index + 1].level > headings[index].level;
}

function isHeadingVisible(headings: HeadingEntry[], index: number, collapsed: Set<number>): boolean {
    let ancestorLevel = headings[index].level;
    for (let i = index - 1; i >= 0; i--) {
        if (headings[i].level < ancestorLevel) {
            if (collapsed.has(headings[i].pos)) return false;
            ancestorLevel = headings[i].level;
        }
    }
    return true;
}

export function initToc(getEditorView: () => EditorView | null): {
    panel: HTMLElement;
    toggle: () => void;
    refresh: () => void;
    updatePosition: () => void;
    show: () => void;
} {
    const panel = document.createElement("div");
    panel.className = "toc-panel";

    const header = document.createElement("div");
    header.className = "toc-header";

    const headerTitle = document.createElement("span");
    headerTitle.className = "toc-header-title";
    headerTitle.textContent = t("Table of Contents");

    // ── Collapse-all / Expand-all button ───────────────────────────────────
    const collapseAllBtn = document.createElement("button");
    collapseAllBtn.className = "toc-pin-btn";
    collapseAllBtn.tabIndex = -1;
    const collapseAllTip = applyTooltip(collapseAllBtn, t("Collapse all"), { placement: "below" });

    function updateCollapseBtn(): void {
        const view = getEditorView();
        const headings = view ? getHeadings(view) : [];
        const anyExpanded = headings.some(
            (h, i) => hasChildren(headings, i) && !collapsedHeadings.has(h.pos),
        );
        collapseAllBtn.innerHTML = anyExpanded ? IconChevronsUp : IconChevronsDown;
        collapseAllTip.setText(anyExpanded ? t("Collapse all") : t("Expand all"));
    }

    // ── Pin button ──────────────────────────────────────────────
    const pinBtn = document.createElement("button");
    pinBtn.className = "toc-pin-btn";
    pinBtn.tabIndex = -1;
    pinBtn.innerHTML = IconPin;
    applyTooltip(pinBtn, t("Pin panel"), { placement: "below" });

    header.appendChild(headerTitle);
    header.appendChild(collapseAllBtn);
    header.appendChild(pinBtn);

    const list = document.createElement("div");
    list.className = "toc-list";

    panel.appendChild(header);
    panel.appendChild(list);

    // ── Right Tab (independent fixed element; JS syncs `left` to align with the panel's right edge)──
    const tabEl = document.createElement("button");
    tabEl.className = "toc-toggle-tab";
    tabEl.tabIndex = -1;
    document.body.appendChild(tabEl);

    let isOpen = false;
    let isAutoShown = false;
    let isPinned = false;
    let panelWidth = TOC_WIDTH;

    // Restore the pin setting and panel width from the webview state
    const savedState = getWebviewState();
    if (savedState?.tocPinned) {
        isPinned = true;
        pinBtn.classList.add("toc-pin-btn--active");
    }
    if (savedState?.tocWidth && typeof savedState.tocWidth === "number") {
        panelWidth = Math.min(TOC_MAX_WIDTH, Math.max(TOC_MIN_WIDTH, savedState.tocWidth));
    }
    panel.style.width = `${panelWidth}px`;

    // ── Collapse state ──────────────────────────────────────────────
    const collapsedHeadings = new Set<number>();
    if (Array.isArray(savedState?.tocCollapsed)) {
        for (const pos of savedState.tocCollapsed) {
            if (typeof pos === "number") collapsedHeadings.add(pos);
        }
    }
    updateCollapseBtn();

    // ── Pin button click ─────────────────────────────────────────
    pinBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        isPinned = !isPinned;
        pinBtn.classList.toggle("toc-pin-btn--active", isPinned);
        // When pinned, do not register the outside-click closer; after unpinning, re-register if the panel is still open
        if (!isPinned && isOpen && !isAutoShown) {
            setTimeout(() => {
                document.addEventListener("mousedown", outsideClickHandler);
            }, 0);
        }
        syncBodyPadding();
        setWebviewState({ ...(getWebviewState() ?? {}), tocPinned: isPinned, tocWidth: panelWidth });
    });

    // ── Collapse-all / Expand-all click ──────────────────────────────────────
    collapseAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const view = getEditorView();
        const headings = view ? getHeadings(view) : [];
        const anyExpanded = headings.some(
            (h, i) => hasChildren(headings, i) && !collapsedHeadings.has(h.pos),
        );
        if (anyExpanded) {
            headings.forEach((h, i) => {
                if (hasChildren(headings, i)) collapsedHeadings.add(h.pos);
            });
            collapseAllBtn.title = t("Expand all");
        } else {
            collapsedHeadings.clear();
            collapseAllBtn.title = t("Collapse all");
        }
        saveCollapsedState();
        updateCollapseBtn();
        refresh();
    });

    function saveCollapsedState(): void {
        setWebviewState({
            ...(getWebviewState() ?? {}),
            tocPinned: isPinned,
            tocWidth: panelWidth,
            tocCollapsed: Array.from(collapsedHeadings),
        });
    }

    function refresh(): void {
        if (!isOpen) return;
        const view = getEditorView();
        if (!view) return;
        const headings = getHeadings(view);
        list.innerHTML = "";
        if (headings.length === 0) {
            const empty = document.createElement("div");
            empty.className = "toc-empty";
            empty.textContent = t("No headings");
            list.appendChild(empty);
            updateCollapseBtn();
            return;
        }
        headings.forEach(({ level, text, pos }, idx) => {
            if (!isHeadingVisible(headings, idx, collapsedHeadings)) return;

            const item = document.createElement("div");
            item.className = `toc-item toc-item--h${level}`;
            item.style.paddingLeft = `${(level - 1) * 12 + 8}px`;

            const hasKids = hasChildren(headings, idx);
            const toggle = document.createElement("span");
            toggle.className = "toc-collapse-toggle";
            if (hasKids) {
                const isCollapsed = collapsedHeadings.has(pos);
                toggle.innerHTML = isCollapsed ? IconChevronRight : IconChevronDown;
                toggle.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isCollapsed) {
                        collapsedHeadings.delete(pos);
                    } else {
                        collapsedHeadings.add(pos);
                    }
                    saveCollapsedState();
                    refresh();
                });
            } else {
                toggle.textContent = "–";
                toggle.style.cursor = "default";
            }
            item.appendChild(toggle);

            const label = document.createElement("span");
            label.className = "toc-item-label";
            label.textContent = text || `${t("Heading")} ${level}`;
            applyTooltip(label, text, { placement: "above", truncatedOnly: true });

            label.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const v = getEditorView();
                if (!v) return;
                try {
                    const el = findHeadingElement(v, pos);
                    if (el) {
                        const topbar = document.querySelector(".milkdown-top-bar") as HTMLElement | null;
                        const topbarH = topbar?.getBoundingClientRect().height ?? DEFAULT_TOPBAR_HEIGHT;
                        const top = el.getBoundingClientRect().top + window.scrollY - topbarH - VIEWPORT_PADDING;
                        window.scrollTo({ top, behavior: "smooth" });
                    }
                } catch { /* heading element is no longer in the DOM; ignore this jump */ }
            });

            item.appendChild(label);
            list.appendChild(item);
        });
        updateCollapseBtn();
    }

    function outsideClickHandler(e: MouseEvent): void {
        if (isPinned) return; // When pinned, outside clicks do not close
        if (!panel.contains(e.target as Node)) {
            close();
        }
    }

    function syncBodyPadding(): void {
        const active = isPinned && isOpen;
        document.body.classList.toggle("toc-pinned", active);
        const topbar = document.querySelector<HTMLElement>(".milkdown-top-bar");
        if (active) {
            document.body.style.paddingRight = `${panelWidth}px`;
            if (topbar) topbar.style.paddingRight = `${panelWidth}px`;
        } else {
            document.body.style.paddingRight = '';
            if (topbar) topbar.style.paddingRight = '';
        }
    }

    function updateTabPos(): void {
        tabEl.style.right = isOpen ? `${panelWidth}px` : '0px';
    }

    function close(): void {
        isOpen = false;
        isAutoShown = false;
        panel.classList.remove("toc-panel--open");
        document.removeEventListener("mousedown", outsideClickHandler);
        updateTabPos();
        syncBodyPadding();
    }

    function openPanel(auto: boolean): void {
        isOpen = true;
        isAutoShown = auto;
        panel.classList.add("toc-panel--open");
        refresh();
        updateTabPos();
        syncBodyPadding();
        if (!auto && !isPinned) {
            // Only register the outside-click closer when opened manually (auto-shown or pinned TOC stays visible)
            setTimeout(() => {
                document.addEventListener("mousedown", outsideClickHandler);
            }, 0);
        }
    }

    function toggle(): void {
        if (isOpen) {
            close();
        } else {
            openPanel(false);
        }
    }

    // Tab: when closed, click=toggle; when open, click=toggle / drag=resize
    let tabDragStart = 0;
    let tabDragWidth = 0;
    let tabDragging = false;
    tabEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Closed state: don't enter drag, just toggle
        if (!isOpen) { toggle(); return; }
        tabDragStart = e.clientX;
        tabDragWidth = panelWidth;
        tabDragging = false;
        document.body.classList.add("toc-resizing");

        function onMove(ev: MouseEvent) {
            const delta = tabDragStart - ev.clientX;
            if (!tabDragging && Math.abs(delta) < 3) return;
            tabDragging = true;
            const newWidth = Math.min(TOC_MAX_WIDTH, Math.max(TOC_MIN_WIDTH, tabDragWidth + delta));
            if (newWidth !== panelWidth) {
                panelWidth = newWidth;
                panel.style.width = `${panelWidth}px`;
                updateTabPos();
                syncBodyPadding();
            }
        }
        function onUp() {
            document.body.classList.remove("toc-resizing");
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            if (!tabDragging) toggle();
            setWebviewState({ ...(getWebviewState() ?? {}), tocPinned: isPinned, tocWidth: panelWidth });
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });

    // ── Auto-show detection ──────────────────────────────────────
    function hasEnoughSpace(): boolean {
        const editorEl = document.getElementById("editor");
        if (!editorEl) {
            return false;
        }
        return (window.innerWidth - editorEl.getBoundingClientRect().right) >= panelWidth;
    }

    function checkAutoShow(): void {
        if (isPinned) return; // When pinned, do not auto-close on window resize
        if (hasEnoughSpace() && !isOpen) {
            openPanel(true);
        } else if (!hasEnoughSpace() && isAutoShown) {
            close();
        }
    }

    // ── Dynamically align to the bottom of the topbar; sync the tab's vertical position ──────────
    function updatePanelPosition(): void {
        const topbar = document.querySelector(".milkdown-top-bar") as HTMLElement | null;
        const topbarH = Math.round(topbar?.getBoundingClientRect().height ?? DEFAULT_TOPBAR_HEIGHT);
        panel.style.top = `${topbarH}px`;
        panel.style.height = `calc(100vh - ${topbarH}px)`;
    }

    updateTabPos();
    requestAnimationFrame(() => {
        updatePanelPosition();
        if (isPinned && !isOpen) {
            openPanel(true);
        }
        checkAutoShow();
    });

    window.addEventListener("resize", () => {
        updatePanelPosition();
        checkAutoShow();
    });

    function show(): void {
        panel.style.visibility = 'visible';
        tabEl.style.visibility = 'visible';
    }

    return { panel, toggle, refresh, updatePosition: updatePanelPosition, show };
}
