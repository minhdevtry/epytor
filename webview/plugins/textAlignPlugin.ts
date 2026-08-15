import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";

export const textAlignPluginKey = new PluginKey("text_align_decorations");

export type TextAlign = "left" | "center" | "right";

/**
 * Parses align tag from text, e.g. <p align="center">, <div align="right">, <h1 align="center">, or style="text-align: center"
 */
export function getAlignFromText(text: string): TextAlign | null {
    const match = text.match(/align=["'](left|center|right)["']/i) ||
                  text.match(/text-align:\s*(left|center|right)/i);
    if (match) {
        return match[1].toLowerCase() as TextAlign;
    }
    return null;
}

/**
 * Get current block's active text alignment
 */
export function getActiveAlignment(view: EditorView): TextAlign | null {
    const { state } = view;
    const { from, to } = state.selection;
    let foundAlign: TextAlign | null = null;

    state.doc.nodesBetween(from, to, (node) => {
        if (node.isBlock && node.textContent) {
            const align = getAlignFromText(node.textContent);
            if (align) {
                foundAlign = align;
                return false;
            }
        }
        return true;
    });

    return foundAlign;
}

/**
 * Set or toggle text alignment for the current block
 */
export function setBlockAlignment(view: EditorView, align: TextAlign): void {
    const { state, dispatch } = view;
    const { from, to } = state.selection;
    const tr = state.tr;
    let modified = false;

    state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isBlock || node.type.name === "doc") return true;

        const currentText = node.textContent;
        const currentAlign = getAlignFromText(currentText);

        if (align === "left") {
            // Left is default: remove any alignment wrapper
            let newText = currentText
                .replace(/^<(?:p|div|h[1-6])\s+align=["'][^"']+["']\s*>/i, "")
                .replace(/<\/(?:p|div|h[1-6])>\s*$/i, "")
                .trim();
            
            const start = pos + 1;
            const end = pos + node.nodeSize - 1;
            if (end >= start) {
                tr.replaceWith(start, end, state.schema.text(newText || " "));
                modified = true;
            }
        } else if (currentAlign) {
            // Change alignment: replace align="old" with align="new"
            const newText = currentText.replace(
                /align=["'][^"']+["']/i,
                `align="${align}"`,
            );
            const start = pos + 1;
            const end = pos + node.nodeSize - 1;
            if (end >= start) {
                tr.replaceWith(start, end, state.schema.text(newText));
                modified = true;
            }
        } else {
            // Wrap in <p align="align">...</p>
            const innerText = currentText.trim();
            const wrappedText = `<p align="${align}">${innerText}</p>`;
            const start = pos + 1;
            const end = pos + node.nodeSize - 1;
            if (end >= start) {
                tr.replaceWith(start, end, state.schema.text(wrappedText));
                modified = true;
            }
        }
        return false;
    });

    if (modified) {
        dispatch(tr);
    }
}

/**
 * Cycle through text alignment sequentially: Left -> Center -> Right -> Left
 */
export function cycleAlignment(view: EditorView): TextAlign {
    const current = getActiveAlignment(view) ?? "left";
    let next: TextAlign = "center";
    if (current === "center") next = "right";
    else if (current === "right") next = "left";
    else next = "center";

    setBlockAlignment(view, next);
    return next;
}

/**
 * ProseMirror plugin to render live visual alignment for aligned blocks
 */
export const textAlignPlugin = $prose(() => {
    return new Plugin({
        key: textAlignPluginKey,
        props: {
            decorations(state) {
                const decos: Decoration[] = [];

                state.doc.descendants((node, pos) => {
                    if (node.isBlock && node.textContent) {
                        const align = getAlignFromText(node.textContent);
                        if (align) {
                            decos.push(
                                Decoration.node(pos, pos + node.nodeSize, {
                                    class: `epytor-align-${align}`,
                                    style: `text-align: ${align} !important;`,
                                }),
                            );
                        }
                    }
                });

                return DecorationSet.create(state.doc, decos);
            },
        },
    });
});
