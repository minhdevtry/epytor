import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

export const calloutPluginKey = new PluginKey("callout_decorations");

const CALLOUT_TITLES: Record<string, string> = {
    note: "NOTE",
    info: "NOTE",
    tip: "TIP",
    warning: "WARNING",
    caution: "CAUTION",
    danger: "CAUTION",
    success: "SUCCESS",
    important: "IMPORTANT",
};

export const calloutPlugin = $prose(() => {
    return new Plugin({
        key: calloutPluginKey,
        props: {
            handleKeyDown(view, event) {
                if (event.key === "Backspace") {
                    const { state } = view;
                    const { selection } = state;
                    if (selection.empty) {
                        const { from } = selection;
                        const $pos = state.doc.resolve(from);
                        if ($pos.parent.type.name === "paragraph") {
                            const pText = $pos.parent.textContent || "";
                            const match = pText.match(/^\\?\[!(NOTE|INFO|TIP|WARNING|CAUTION|DANGER|SUCCESS|IMPORTANT)\\?\]\s*/i);
                            if (match) {
                                const tagLen = match[0].length;
                                const tagEndPos = $pos.start() + tagLen;
                                if (from === tagEndPos) {
                                    event.preventDefault();
                                    const tr = state.tr.delete($pos.start(), tagEndPos);
                                    view.dispatch(tr);
                                    return true;
                                }
                            }
                        }
                    }
                }
                return false;
            },
            decorations(state) {
                const decos: Decoration[] = [];

                state.doc.descendants((node, pos) => {
                    if (node.type.name === "blockquote") {
                        const firstChild = node.firstChild;
                        if (firstChild && firstChild.type.name === "paragraph") {
                            const text = firstChild.textContent || "";
                            // Match [!NOTE] or escaped \[!NOTE\]
                            const match = text.match(/^\\?\[!(NOTE|INFO|TIP|WARNING|CAUTION|DANGER|SUCCESS|IMPORTANT)\\?\]\s*/i);
                            if (match) {
                                const rawType = match[1].toLowerCase();
                                const type = rawType === "info" ? "note" : rawType === "danger" ? "caution" : rawType;
                                const title = CALLOUT_TITLES[rawType] || rawType.toUpperCase();

                                // Add callout container class to blockquote
                                decos.push(
                                    Decoration.node(pos, pos + node.nodeSize, {
                                        class: `callout callout-${type}`,
                                    }),
                                );

                                // Replace [!TAG] with a single unified Callout Tag Badge
                                const tagLen = match[0].length;
                                decos.push(
                                    Decoration.inline(pos + 2, pos + 2 + tagLen, {
                                        class: `callout-badge-tag callout-badge-tag-${type}`,
                                        "data-title": title,
                                    }),
                                );
                            }
                        }
                    }
                });

                return DecorationSet.create(state.doc, decos);
            },
        },
    });
});
