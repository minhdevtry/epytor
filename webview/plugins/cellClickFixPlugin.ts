import { $prose } from "@milkdown/kit/utils";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Plugin, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import { CellSelection, TableMap } from "@milkdown/kit/prose/tables";

export function getCellCoords(doc: any, pos: number): { row: number; col: number } | null {
    try {
        const $pos = doc.resolve(pos);
        for (let d = $pos.depth; d >= 0; d--) {
            const typeName = $pos.node(d).type.name;
            if (typeName === "table_cell" || typeName === "table_header") {
                for (let td = d - 1; td >= 0; td--) {
                    if ($pos.node(td).type.name === "table") {
                        const tableNode = $pos.node(td);
                        const tableStart = $pos.start(td);
                        const cellRelPos = $pos.before(d) - tableStart;
                        const map = TableMap.get(tableNode);
                        const rect = map.findCell(cellRelPos);
                        return { row: rect.top + 1, col: rect.left + 1 };
                    }
                }
            }
        }
    } catch { /* Non-table node or abnormal structure, return null */ }
    return null;
}

export const cellClickFixPlugin = $prose(() => {
    let pendingClickPos: number | null = null;
    let cellClickTarget: number | null = null;
    let clickIsPlain = true;
    let wasCrossCell = false;
    let lastGoodCellSelection: CellSelection | null = null;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let capturedView: EditorView | null = null;

    return new Plugin({
        view(editorView) {
            capturedView = editorView;
            return {
                destroy() {
                    capturedView = null;
                },
            };
        },
        props: {
            handleDOMEvents: {
                mousedown: (view, event) => {
                    if (event.button !== 0 || event.detail !== 1 || event.shiftKey || event.ctrlKey || event.metaKey) {
                        pendingClickPos = null;
                        return false;
                    }
                    const cell = (event.target as Element).closest("td, th");
                    if (!cell) {
                        pendingClickPos = null;
                        return false;
                    }
                    const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
                    pendingClickPos = pos ? pos.pos : null;
                    cellClickTarget = pos ? pos.pos : null;
                    clickIsPlain = true;
                    wasCrossCell = false;
                    lastGoodCellSelection = null;
                    lastMouseX = event.clientX;
                    lastMouseY = event.clientY;

                    const onMove = (mv: MouseEvent) => {
                        lastMouseX = mv.clientX;
                        lastMouseY = mv.clientY;
                        if (Math.abs(mv.clientX - event.clientX) + Math.abs(mv.clientY - event.clientY) > 4) clickIsPlain = false;
                    };
                    document.addEventListener("mousemove", onMove, true);

                    const cleanup = () => {
                        document.removeEventListener("mouseup", cleanup, true);
                        document.removeEventListener("mousemove", onMove, true);
                        if (wasCrossCell) {
                            pendingClickPos = null;
                            clickIsPlain = true;
                            wasCrossCell = false;
                            const savedCellSel = lastGoodCellSelection;
                            setTimeout(() => {
                                if (lastGoodCellSelection === savedCellSel) lastGoodCellSelection = null;
                            }, 200);
                        } else {
                            Promise.resolve().then(() => {
                                pendingClickPos = null;
                                clickIsPlain = true;
                            });
                        }
                    };
                    document.addEventListener("mouseup", cleanup, true);
                    return false;
                },
            },
        },
        filterTransaction(tr, state) {
            if (tr.selection instanceof NodeSelection) {
                try {
                    const $pos = state.doc.resolve(Math.min(tr.selection.from, state.doc.content.size));
                    for (let d = $pos.depth; d >= 0; d--) {
                        const t = $pos.node(d).type.name;
                        if (t === "table_cell" || t === "table_header") {
                            const clickPos = cellClickTarget;
                            cellClickTarget = null;
                            requestAnimationFrame(() => {
                                const v = capturedView;
                                if (!v) return;
                                const sel = v.state.selection;
                                if (sel instanceof TextSelection && sel.from === sel.to) return;
                                try {
                                    const p = Math.min(clickPos ?? tr.selection.from, v.state.doc.content.size);
                                    v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(p))));
                                } catch { /* Position invalid, ignore */ }
                            });
                            return false;
                        }
                    }
                } catch { /* Traverse error, ignore */ }
            }
            if (!lastGoodCellSelection) return true;
            if (state.selection instanceof CellSelection && !(tr.selection instanceof CellSelection)) {
                return false;
            }
            return true;
        },
        appendTransaction(_trs, _oldState, newState) {
            if (pendingClickPos === null) return null;
            const sel = newState.selection;
            const $pos = newState.doc.resolve(Math.min(pendingClickPos, newState.doc.content.size));

            if (sel instanceof CellSelection) {
                if (sel.isRowSelection() || sel.isColSelection()) return null;
                if (sel.$anchorCell.pos !== sel.$headCell.pos) {
                    wasCrossCell = true;
                    lastGoodCellSelection = sel;
                    return null;
                }
                try {
                    if (!clickIsPlain && capturedView) {
                        const toCoords = capturedView.posAtCoords({ left: lastMouseX, top: lastMouseY });
                        if (toCoords) {
                            const headP = Math.min(toCoords.pos, newState.doc.content.size);
                            try {
                                const $a = newState.doc.resolve(Math.min(pendingClickPos, newState.doc.content.size));
                                const $h = newState.doc.resolve(headP);
                                let aCellStart = -1;
                                let hCellStart = -1;
                                for (let d = $a.depth; d >= 0; d--) {
                                    if ($a.node(d).type.name === "table_cell" || $a.node(d).type.name === "table_header") {
                                        aCellStart = $a.start(d);
                                        break;
                                    }
                                }
                                for (let d = $h.depth; d >= 0; d--) {
                                    if ($h.node(d).type.name === "table_cell" || $h.node(d).type.name === "table_header") {
                                        hCellStart = $h.start(d);
                                        break;
                                    }
                                }
                                if (aCellStart !== hCellStart) return null;
                            } catch { /* Boundary check failure, fallback */ }
                            return newState.tr.setSelection(TextSelection.create(newState.doc, headP, Math.min(pendingClickPos, newState.doc.content.size)));
                        }
                    }
                    return newState.tr.setSelection(TextSelection.near($pos));
                } catch {
                    return null;
                }
            }

            return null;
        },
    });
});
