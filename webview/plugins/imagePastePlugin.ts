import { $prose } from "@milkdown/kit/utils";
import { Plugin } from "@milkdown/kit/prose/state";

/**
 * Prevents ProseMirror / Milkdown default paste and drop handlers from inserting
 * temporary blob: URLs when image files are pasted or dropped.
 * The real upload is handled by the capturing event listeners in webview/index.ts.
 */
export const imagePastePlugin = $prose(
    () =>
        new Plugin({
            props: {
                handlePaste(_view, event) {
                    const items = event.clipboardData?.items;
                    if (!items) return false;
                    const hasImage = Array.from(items).some((i) => i.type.startsWith("image/"));
                    if (hasImage) {
                        return true; // Intercept: do not let ProseMirror create a local blob node
                    }
                    return false;
                },
                handleDrop(_view, event) {
                    const files = (event as DragEvent).dataTransfer?.files;
                    if (!files?.length) return false;
                    const hasImage = Array.from(files).some((f) => f.type.startsWith("image/"));
                    if (hasImage) {
                        return true; // Intercept: do not let ProseMirror create a local blob node
                    }
                    return false;
                },
            },
        }),
);
