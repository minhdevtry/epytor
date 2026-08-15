import "./stickyHeading.css";
import type { EditorView } from "@milkdown/kit/prose/view";
import { DEFAULT_TOPBAR_HEIGHT, VIEWPORT_PADDING } from "../../../shared/constants";
import { IconChevronDown, IconChevronRight } from "@/ui/icons";
import { isHeadingFolded, toggleHeadingFold } from "@/plugins/headingFoldPlugin";

export function initStickyHeading(getEditorView: () => EditorView | null): {
    bar: HTMLElement;
    update: () => void;
} {
    const bar = document.createElement("div");
    bar.className = "epytor-sticky-heading-bar";

    const levelBadge = document.createElement("span");
    levelBadge.className = "epytor-sticky-level";

    const titleSpan = document.createElement("span");
    titleSpan.className = "epytor-sticky-title";

    const foldBtn = document.createElement("button");
    foldBtn.className = "epytor-sticky-fold-btn";
    foldBtn.tabIndex = -1;

    bar.appendChild(levelBadge);
    bar.appendChild(titleSpan);
    bar.appendChild(foldBtn);
    document.body.appendChild(bar);

    let activeHeadingPos: number | null = null;
    let activeHeadingLevel = 1;

    function update(): void {
        const view = getEditorView();
        if (!view) {
            bar.classList.remove("is-visible");
            return;
        }

        const topbar = document.querySelector(".milkdown-top-bar") as HTMLElement | null;
        const topbarHeight = topbar?.getBoundingClientRect().height ?? DEFAULT_TOPBAR_HEIGHT;
        const threshold = topbarHeight + 30;

        let bestHeading: { pos: number; level: number; text: string; domTop: number } | null = null;

        view.state.doc.descendants((node, pos) => {
            if (node.type.name === "heading") {
                const dom = view.nodeDOM(pos) as HTMLElement | null;
                if (dom) {
                    const rect = dom.getBoundingClientRect();
                    if (rect.top <= threshold) {
                        bestHeading = {
                            pos,
                            level: (node.attrs["level"] as number) || 1,
                            text: node.textContent,
                            domTop: rect.top,
                        };
                    }
                }
            }
        });

        if (bestHeading && window.scrollY > 80) {
            activeHeadingPos = (bestHeading as any).pos;
            activeHeadingLevel = (bestHeading as any).level;
            levelBadge.textContent = `H${activeHeadingLevel}`;
            titleSpan.textContent = (bestHeading as any).text;

            const isFolded = activeHeadingPos !== null && isHeadingFolded(activeHeadingPos);
            foldBtn.innerHTML = isFolded ? IconChevronRight : IconChevronDown;
            foldBtn.title = isFolded ? "Expand section" : "Collapse section";

            bar.classList.add("is-visible");
        } else {
            activeHeadingPos = null;
            bar.classList.remove("is-visible");
        }
    }

    // Scroll to heading on bar click
    bar.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".epytor-sticky-fold-btn")) {
            return; // Handled by foldBtn
        }
        if (activeHeadingPos === null) return;
        const view = getEditorView();
        if (!view) return;

        const dom = view.nodeDOM(activeHeadingPos) as HTMLElement | null;
        if (dom) {
            const topbar = document.querySelector(".milkdown-top-bar") as HTMLElement | null;
            const topbarHeight = topbar?.getBoundingClientRect().height ?? DEFAULT_TOPBAR_HEIGHT;
            const targetY = dom.getBoundingClientRect().top + window.scrollY - topbarHeight - VIEWPORT_PADDING;
            window.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
        }
    });

    // Fold toggle on button click
    foldBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (activeHeadingPos === null) return;
        const view = getEditorView();
        if (!view) return;
        toggleHeadingFold(view, activeHeadingPos);
        update();
    });

    let scrollRaf: number | null = null;
    window.addEventListener("scroll", () => {
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
        scrollRaf = requestAnimationFrame(() => {
            update();
            scrollRaf = null;
        });
    }, { passive: true });

    return { bar, update };
}
