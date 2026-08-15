import { $prose } from "@milkdown/kit/utils";
import { schemaCtx } from "@milkdown/kit/core";
import { Plugin } from "@milkdown/kit/prose/state";

export const listSpreadNormalizePlugin = $prose((ctx) => {
    const schema = ctx.get(schemaCtx);
    return new Plugin({
        appendTransaction(transactions, _oldState, newState) {
            if (!transactions.some((tr) => tr.docChanged)) return null;
            let minFrom = newState.doc.content.size;
            let maxTo = 0;
            for (const tr of transactions) {
                if (!tr.docChanged) continue;
                for (const step of tr.steps) {
                    step.getMap().forEach((_os, _oe, newStart, newEnd) => {
                        if (newStart < minFrom) minFrom = newStart;
                        if (newEnd > maxTo) maxTo = newEnd;
                    });
                }
            }
            if (minFrom > maxTo) return null;
            const tr = newState.tr;
            let changed = false;
            newState.doc.nodesBetween(minFrom, maxTo, (node, pos) => {
                if (node.type !== schema.nodes.bullet_list && node.type !== schema.nodes.ordered_list)
                    return;
                let listNeedsSpread = false;
                let offset = 1;
                node.forEach((item) => {
                    const itemNeedsSpread = item.childCount > 1;
                    if (item.attrs.spread !== itemNeedsSpread) {
                        tr.setNodeMarkup(pos + offset, undefined, { ...item.attrs, spread: itemNeedsSpread });
                        changed = true;
                    }
                    if (itemNeedsSpread) listNeedsSpread = true;
                    offset += item.nodeSize;
                });
                if (node.attrs.spread !== listNeedsSpread) {
                    tr.setNodeMarkup(pos, undefined, { ...node.attrs, spread: listNeedsSpread });
                    changed = true;
                }
            });
            return changed ? tr : null;
        },
    });
});
