import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

export const markHighlightPluginKey = new PluginKey("mark_highlight_decorations");

const DEFAULT_HIGHLIGHT_COLOR = "rgba(250, 204, 21, 0.45)";

export const markHighlightPlugin = $prose(() => {
    return new Plugin({
        key: markHighlightPluginKey,
        props: {
            decorations(state) {
                const decos: Decoration[] = [];

                // 1. Traverse document to match HTML <mark> and </mark> nodes
                let activeMark: { startPos: number; color: string } | null = null;

                state.doc.descendants((node, pos) => {
                    // Case A: Parsed HTML nodes: <mark ...> and </mark>
                    if (node.type.name === "html") {
                        const val = ((node.attrs?.value as string) || "").trim();
                        const openMatch = val.match(/^<mark(?:\s+style=["'](?:background(?:-color)?:\s*([^;"']+))[^"']*["'])?>/i);
                        if (openMatch) {
                            const color = openMatch[1] || DEFAULT_HIGHLIGHT_COLOR;
                            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "mark-tag-hidden" }));
                            activeMark = { startPos: pos + node.nodeSize, color };
                            return false;
                        }

                        if (/^<\/mark>/i.test(val) && activeMark) {
                            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "mark-tag-hidden" }));
                            if (pos > activeMark.startPos) {
                                decos.push(
                                    Decoration.inline(activeMark.startPos, pos, {
                                        class: "text-highlight-inline",
                                        style: `background-color: ${activeMark.color};`,
                                    }),
                                );
                            }
                            activeMark = null;
                            return false;
                        }
                    }

                    // Case B: Raw unparsed text containing <mark>...</mark> in a single text node
                    if (node.isText && !activeMark) {
                        const text = node.text || "";
                        const markRegex = /<mark(?:\s+style=["'](?:background(?:-color)?:\s*([^;"']+))[^"']*["'])?>([\s\S]*?)<\/mark>/gi;
                        let match: RegExpExecArray | null;
                        while ((match = markRegex.exec(text)) !== null) {
                            const fullMatch = match[0];
                            const bgColor = match[1] || DEFAULT_HIGHLIGHT_COLOR;
                            const openTagMatch = fullMatch.match(/^<mark(?:\s+style=["'][^"']*["'])?>/i);
                            const openTagLen = openTagMatch ? openTagMatch[0].length : 6;
                            const closeTagLen = 7; // </mark>

                            const matchStart = pos + match.index;
                            const contentStart = matchStart + openTagLen;
                            const contentEnd = matchStart + fullMatch.length - closeTagLen;
                            const matchEnd = matchStart + fullMatch.length;

                            if (contentStart <= contentEnd) {
                                decos.push(Decoration.inline(matchStart, contentStart, { class: "mark-tag-hidden" }));
                                if (contentStart < contentEnd) {
                                    decos.push(
                                        Decoration.inline(contentStart, contentEnd, {
                                            class: "text-highlight-inline",
                                            style: `background-color: ${bgColor};`,
                                        }),
                                    );
                                }
                                decos.push(Decoration.inline(contentEnd, matchEnd, { class: "mark-tag-hidden" }));
                            }
                        }
                    }
                });

                return DecorationSet.create(state.doc, decos);
            },
        },
    });
});
