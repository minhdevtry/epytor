import { $prose } from "@milkdown/kit/utils";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Plugin } from "@milkdown/kit/prose/state";

let _onSelectionChange: ((view: EditorView) => void) | null = null;

export function registerSelectionChangeHandler(cb: (view: EditorView) => void): void {
    _onSelectionChange = cb;
}

export const selectionPlugin = $prose(
    () =>
        new Plugin({
            view: () => ({
                update(view, prevState) {
                    if (
                        _onSelectionChange &&
                        (!view.state.selection.eq(prevState.selection) ||
                         !view.state.doc.eq(prevState.doc))
                    ) {
                        _onSelectionChange(view);
                    }
                },
            }),
        }),
);
