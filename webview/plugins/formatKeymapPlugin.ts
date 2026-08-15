import { $prose } from "@milkdown/kit/utils";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import {
    toggleStrongCommand,
    toggleEmphasisCommand,
    toggleInlineCodeCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { keymap } from "@milkdown/kit/prose/keymap";
import { undo, redo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";

export const formatKeymapPlugin = $prose((ctx) =>
    keymap({
        "Mod-z": (state, dispatch, view) => undo(state, dispatch, view),
        "Mod-y": (state, dispatch, view) => redo(state, dispatch, view),
        "Mod-Shift-z": (state, dispatch, view) => redo(state, dispatch, view),
        "Shift-Mod-z": (state, dispatch, view) => redo(state, dispatch, view),
        "Mod-b": () => {
            ctx.get(commandsCtx).call(toggleStrongCommand.key);
            return true;
        },
        "Mod-i": () => {
            ctx.get(commandsCtx).call(toggleEmphasisCommand.key);
            return true;
        },
        "Mod-Shift-x": () => {
            ctx.get(commandsCtx).call(toggleStrikethroughCommand.key);
            return true;
        },
        "Mod-e": () => {
            const view = ctx.get(editorViewCtx);
            const { state } = view;
            if (!state.selection.empty) {
                ctx.get(commandsCtx).call(toggleInlineCodeCommand.key);
                return true;
            }
            const codeMark = state.schema.marks["inlineCode"];
            if (!codeMark) return true;
            const { from } = state.selection;
            const textNode = state.schema.text("​", [codeMark.create()]);
            const tr = state.tr.insert(from, textNode);
            tr.setSelection(TextSelection.create(tr.doc, from + 1));
            view.dispatch(tr);
            return true;
        },
        "Shift-Enter": (state, dispatch) => {
            // Soft break in table cells
            const { $from } = state.selection;
            let inTable = false;
            for (let d = $from.depth; d >= 0; d--) {
                const typeName = $from.node(d).type.name;
                if (typeName === "table_cell" || typeName === "table_header") {
                    inTable = true;
                    break;
                }
            }
            if (inTable && dispatch) {
                const hardBreak = state.schema.nodes["hard_break"];
                if (hardBreak) {
                    dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
                    return true;
                }
            }
            return false;
        },
    }),
);
