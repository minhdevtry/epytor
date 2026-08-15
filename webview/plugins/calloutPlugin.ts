import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

export const calloutPluginKey = new PluginKey("callout_decorations");

const CALLOUT_ICONS: Record<string, { icon: string; title: string }> = {
    note: { icon: "ℹ️", title: "NOTE" },
    info: { icon: "ℹ️", title: "NOTE" },
    tip: { icon: "💡", title: "TIP" },
    warning: { icon: "⚠️", title: "WARNING" },
    caution: { icon: "🛑", title: "CAUTION" },
    danger: { icon: "🛑", title: "CAUTION" },
    success: { icon: "✅", title: "SUCCESS" },
    important: { icon: "📌", title: "IMPORTANT" },
};

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
                            // Match [!NOTE] or escaped \[!NOTE\]
                            const match = text.match(/^\\?\[!(NOTE|INFO|TIP|WARNING|CAUTION|DANGER|SUCCESS|IMPORTANT)\\?\]\s*/i);
                            if (match) {
                                const rawType = match[1].toLowerCase();
                                const type = rawType === "info" ? "note" : rawType === "danger" ? "caution" : rawType;
                                const meta = CALLOUT_ICONS[rawType] || { icon: "💬", title: rawType.toUpperCase() };

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
                                        "data-icon": meta.icon,
                                        "data-title": meta.title,
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
