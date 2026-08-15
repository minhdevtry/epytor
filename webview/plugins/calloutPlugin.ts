import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

export const calloutPluginKey = new PluginKey("callout_decorations");

export const calloutPlugin = $prose(() => {
    return new Plugin({
        key: calloutPluginKey,
        props: {
            decorations(state) {
                const decos: Decoration[] = [];
                state.doc.descendants((node, pos) => {
                    if (node.type.name === "blockquote") {
                        const firstChild = node.firstChild;
                        if (firstChild && firstChild.type.name === "paragraph") {
                            const text = firstChild.textContent || "";
                            const match = text.match(/^\[!(NOTE|INFO|TIP|WARNING|CAUTION|DANGER|SUCCESS|IMPORTANT)\]\s*/i);
                            if (match) {
                                const rawType = match[1].toLowerCase();
                                const type = rawType === "info" ? "note" : rawType === "danger" ? "caution" : rawType;
                                decos.push(
                                    Decoration.node(pos, pos + node.nodeSize, {
                                        class: `callout callout-${type}`,
                                    }),
                                );
                                const tagLen = match[0].length;
                                decos.push(
                                    Decoration.inline(pos + 2, pos + 2 + tagLen, {
                                        class: `callout-tag-hidden`,
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
