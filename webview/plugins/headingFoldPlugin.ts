import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { IconChevronRight, IconChevronDown } from "../ui/icons";

export const headingFoldPluginKey = new PluginKey("heading_fold_decorations");

export const collapsedHeadingPositions = new Set<number>();

/**
 * Toggle fold state for a heading at pos
 */
export function toggleHeadingFold(view: EditorView, headingPos: number): void {
    if (collapsedHeadingPositions.has(headingPos)) {
        collapsedHeadingPositions.delete(headingPos);
    } else {
        collapsedHeadingPositions.add(headingPos);
    }
    // Force decoration recalculation
    view.dispatch(view.state.tr.setMeta(headingFoldPluginKey, { toggled: headingPos }));
}

export function isHeadingFolded(headingPos: number): boolean {
    return collapsedHeadingPositions.has(headingPos);
}

export function expandAllHeadings(view: EditorView): void {
    collapsedHeadingPositions.clear();
    view.dispatch(view.state.tr.setMeta(headingFoldPluginKey, { reset: true }));
}

/**
 * ProseMirror plugin to handle heading section folding & unfolding
 */
export const headingFoldPlugin = $prose(() => {
    return new Plugin({
        key: headingFoldPluginKey,
        props: {
            handleClick(view, pos, event) {
                const target = (event.target as HTMLElement).closest(".epytor-heading-fold-btn, .epytor-folded-indicator");
                if (!target) return false;

                const posAttr = target.getAttribute("data-pos");
                if (posAttr) {
                    const headingPos = parseInt(posAttr, 10);
                    if (!isNaN(headingPos)) {
                        toggleHeadingFold(view, headingPos);
                        event.preventDefault();
                        event.stopPropagation();
                        return true;
                    }
                }
                return false;
            },
            decorations(state) {
                const decos: Decoration[] = [];
                const doc = state.doc;
                const headings: Array<{ pos: number; level: number; nodeSize: number }> = [];

                doc.descendants((node, pos) => {
                    if (node.type.name === "heading") {
                        headings.push({
                            pos,
                            level: (node.attrs["level"] as number) || 1,
                            nodeSize: node.nodeSize,
                        });
                    }
                });

                headings.forEach((h, index) => {
                    const isCollapsed = collapsedHeadingPositions.has(h.pos);

                    // Add fold toggle button widget inside heading
                    const btn = document.createElement("span");
                    btn.className = `epytor-heading-fold-btn ${isCollapsed ? "is-collapsed" : ""}`;
                    btn.setAttribute("data-pos", String(h.pos));
                    btn.setAttribute("title", isCollapsed ? "Expand section" : "Collapse section");
                    btn.innerHTML = isCollapsed ? IconChevronRight : IconChevronDown;

                    decos.push(Decoration.widget(h.pos + 1, btn, { side: -1 }));

                    if (isCollapsed) {
                        // Find where this folded section ends
                        let foldEnd = doc.content.size;
                        for (let i = index + 1; i < headings.length; i++) {
                            if (headings[i].level <= h.level) {
                                foldEnd = headings[i].pos;
                                break;
                            }
                        }

                        const foldStart = h.pos + h.nodeSize;
                        if (foldEnd > foldStart) {
                            // Hide nodes in the folded range
                            doc.nodesBetween(foldStart, foldEnd, (childNode, childPos) => {
                                if (childNode.isBlock && childPos >= foldStart && childPos < foldEnd) {
                                    decos.push(
                                        Decoration.node(childPos, childPos + childNode.nodeSize, {
                                            class: "epytor-folded-node",
                                        }),
                                    );
                                }
                            });

                            // Add collapsed summary banner widget
                            const indicator = document.createElement("div");
                            indicator.className = "epytor-folded-indicator";
                            indicator.setAttribute("data-pos", String(h.pos));
                            indicator.innerHTML = `<span class="epytor-folded-icon">${IconChevronRight}</span><span class="epytor-folded-text">Section collapsed (click to expand)</span>`;

                            decos.push(Decoration.widget(foldStart, indicator, { side: 1 }));
                        }
                    }
                });

                return DecorationSet.create(doc, decos);
            },
        },
    });
});
