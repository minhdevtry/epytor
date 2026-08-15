import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

export const calloutPluginKey = new PluginKey("callout_decorations");

const CALLOUT_ICONS: Record<string, { icon: string; title: string }> = {
    note: { icon: "ℹ️", title: "Note" },
    info: { icon: "ℹ️", title: "Info" },
    tip: { icon: "💡", title: "Tip" },
    warning: { icon: "⚠️", title: "Warning" },
    caution: { icon: "🛑", title: "Caution" },
    danger: { icon: "🛑", title: "Danger" },
    success: { icon: "✅", title: "Success" },
    important: { icon: "📌", title: "Important" },
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

                                // Add a badge header widget at start of blockquote
                                const badge = document.createElement("div");
                                badge.className = `callout-header-badge callout-badge-${type}`;
                                badge.innerHTML = `<span class="callout-icon">${meta.icon}</span><span class="callout-title">${meta.title}</span>`;
                                decos.push(Decoration.widget(pos + 1, badge, { side: -1 }));

                                // Hide the [!TAG] text
                                const tagLen = match[0].length;
                                decos.push(
                                    Decoration.inline(pos + 2, pos + 2 + tagLen, {
                                        class: "callout-tag-hidden",
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
