import { $prose } from "@milkdown/kit/utils";
import { schemaCtx } from "@milkdown/kit/core";
import { Plugin } from "@milkdown/kit/prose/state";
import { keymap } from "@milkdown/kit/prose/keymap";
import { liftListItem, sinkListItem } from "@milkdown/kit/prose/schema-list";

export const listLiftPlugin = $prose((ctx) => {
    const schema = ctx.get(schemaCtx);
    const listItemType = schema.nodes["list_item"];
    if (!listItemType) {
        return new Plugin({});
    }
    const doLift = liftListItem(listItemType);
    const doSink = sinkListItem(listItemType);
    return keymap({
        Tab: (state, dispatch) => {
            const { selection } = state;
            const { $from } = selection;
            let inList = false;
            for (let d = $from.depth; d >= 0; d--) {
                if ($from.node(d).type === listItemType) { inList = true; break; }
            }
            if (!inList) return false;
            return doSink(state, dispatch);
        },
        "Shift-Tab": (state, dispatch) => {
            const { selection } = state;
            const { $from } = selection;
            let inList = false;
            for (let d = $from.depth; d >= 0; d--) {
                if ($from.node(d).type === listItemType) { inList = true; break; }
            }
            if (!inList) return false;
            return doLift(state, dispatch);
        },
        Backspace: (state, dispatch) => {
            const { selection } = state;
            if (!selection.empty) return false;
            const { $from } = selection;
            if ($from.parentOffset !== 0) return false;
            let inList = false;
            for (let d = $from.depth; d >= 0; d--) {
                if ($from.node(d).type === listItemType) { inList = true; break; }
            }
            if (!inList) return false;
            return doLift(state, dispatch);
        },
    });
});
