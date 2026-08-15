import {
    commandsCtx,
    defaultValueCtx,
    Editor,
    editorViewCtx,
    nodeViewCtx,
    rootCtx,
    schemaCtx,
} from "@milkdown/kit/core";
import {
    toggleStrongCommand,
    toggleEmphasisCommand,
    toggleInlineCodeCommand,
    listItemSchema,
    wrapInBlockTypeCommand,
    clearTextInCurrentBlockCommand,
    codeBlockSchema,
    addBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { undo, redo } from "@milkdown/kit/prose/history";
import { keymap } from "@milkdown/kit/prose/keymap";
import { Plugin, PluginKey, NodeSelection, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import { liftListItem, sinkListItem } from "@milkdown/kit/prose/schema-list";
import { lift, wrapIn } from "prosemirror-commands";
import { CellSelection, TableMap } from "@milkdown/kit/prose/tables";
import { $prose } from "@milkdown/kit/utils";
import type { Ctx } from "@milkdown/kit/ctx";
import { CrepeBuilder } from "@milkdown/crepe";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";
import { blockEdit } from "@milkdown/crepe/feature/block-edit";
import { TbUndo, TbRedo, TbImage, TbEraser, TbGear, TbToc, TbHighlighter } from "./ui/icons";

// 调试日志开关（由 index.ts setDebugMode 消息驱动）
let logTableSel = false;
export function setLogTableSel(enabled: boolean): void {
    logTableSel = enabled;
}

// ─── Crepe 原生功能 ──────────────────────────────────────────────────────────
// 以下 feature 由 @milkdown/crepe 官方维护，替换我们的自定义实现：
//   feature/table       → 替换 addButtons + handles + toolbar（1,562 行）
//   feature/code-mirror → 替换 codeBlock NodeView + Prism（1,909 行）
//   feature/toolbar     → 选中文字浮动工具栏（启用）
//   feature/latex       → 全新：KaTeX 数学公式支持
// feature/code-mirror → 换回自定义实现（复制反馈、全屏、样式更精致）
import { codeMirror } from "@milkdown/crepe/feature/code-mirror";
import { cursor } from "@milkdown/crepe/feature/cursor";
import { latex } from "@milkdown/crepe/feature/latex";
import { listItem } from "@milkdown/crepe/feature/list-item";
import { table } from "@milkdown/crepe/feature/table";
import { topBar } from "@milkdown/crepe/feature/top-bar";
import { toolbar } from "@milkdown/crepe/feature/toolbar";
import { Compartment } from "@codemirror/state";
import { EditorView as CMEditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages as allCodeLanguages } from "@codemirror/language-data";
import mermaid from "mermaid";
import { onThemeChange } from "./utils/themeBus";
import { t } from "./i18n";

// 只保留常用语言（143 → ~40）
const WANTED_LANGS = new Set([
    "bash", "sh", "c", "cpp", "c++", "csharp", "c#", "css", "go", "html",
    "java", "javascript", "js", "json", "kotlin", "latex", "less", "lua",
    "markdown", "md", "mermaid", "php", "python", "py", "ruby", "rust",
    "sass", "scss", "sql", "swift", "toml", "typescript", "ts", "xml", "yaml", "yml",
]);
const codeLanguages = allCodeLanguages.filter(
    (l: { alias: string[] }) => l.alias.some((a) => WANTED_LANGS.has(a))
);
// Mermaid 不在 @codemirror/language-data 中，手动添加（仅标签，无语法高亮）
codeLanguages.unshift({
    name: "Text",
    alias: ["text", "plaintext", "txt"],
    extensions: ["txt"],
    load: async () => undefined,
});
codeLanguages.push({
    name: "Mermaid",
    alias: ["mermaid"],
    extensions: ["mmd"],
    load: async () => undefined,
});
// feature/toolbar 暂不启用（与自定义工具栏冲突）

// ─── 保留的自定义插件 ────────────────────────────────────────────────────────
// 以下插件 Crepe 不提供对应功能，永久保留：
//   listLiftPlugin           → 列表 backspace 上升一级
//   listSpreadNormalizePlugin → 列表 spread 规范化
//   selectionPlugin          → 选区变更回调（驱动外部 UI）
//   formatKeymapPlugin       → 自定义格式化快捷键

// 列表快捷键：Tab 缩进一级，Shift-Tab 提升一级，行首 Backspace 上升一级/转为段落
const listLiftPlugin = $prose((ctx) => {
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

// 格式化快捷键：Mod-b 粗体、Mod-i 斜体、Mod-Shift-x 删除线、Mod-e 行内代码、Mod-z 撤销、Mod-Shift-z 重做
const formatKeymapPlugin = $prose((ctx) =>
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
    }),
);

// 选区变更回调（由 index.ts 注入，用于驱动工具栏等外部 UI）
let _onSelectionChange: ((view: EditorView) => void) | null = null;
export function registerSelectionChangeHandler(cb: (view: EditorView) => void): void {
    _onSelectionChange = cb;
}

const selectionPlugin = $prose(
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

// 列表 spread 规范化：编辑后若列表项只含单个块级子节点，自动将 spread 重置为 false
const listSpreadNormalizePlugin = $prose((ctx) => {
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

// ─── 表格单元格点击修正 ──────────────────────────────────────────────────────

function getCellCoords(doc: any, pos: number): { row: number; col: number } | null {
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
    } catch { /* 非表格节点或文档结构异常，返回 null */ }
    return null;
}

const cellClickFixPlugin = $prose(() => {
    let pendingClickPos: number | null = null;
    let cellClickTarget: number | null = null; // 表格单击位置，不受 mouseup 清理影响
    let clickIsPlain = true;
    let wasCrossCell = false;
    let lastGoodCellSelection: CellSelection | null = null;
    let multiSelectCount = 0;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let capturedView: EditorView | null = null;

    return new Plugin({
        view(editorView) {
            capturedView = editorView;
            return { destroy() { capturedView = null; } };
        },
        props: {
            handleDOMEvents: {
                mousedown: (view, event) => {
                    if (event.button !== 0 || event.detail !== 1 || event.shiftKey || event.ctrlKey || event.metaKey) {
                        pendingClickPos = null;
                        return false;
                    }
                    const cell = (event.target as Element).closest("td, th");
                    if (!cell) { pendingClickPos = null; return false; }
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
                            setTimeout(() => { if (lastGoodCellSelection === savedCellSel) lastGoodCellSelection = null; }, 200);
                        } else {
                            Promise.resolve().then(() => { pendingClickPos = null; clickIsPlain = true; });
                        }
                    };
                    document.addEventListener("mouseup", cleanup, true);
                    return false;
                },
            },
        },
        filterTransaction(tr, state) {
            // 原生表格单击→NodeSelection（单元格内段落）→拦截并转为光标定位
            if (tr.selection instanceof NodeSelection) {
                try {
                    const $pos = state.doc.resolve(Math.min(tr.selection.from, state.doc.content.size));
                    for (let d = $pos.depth; d >= 0; d--) {
                        const t = $pos.node(d).type.name;
                        if (t === "table_cell" || t === "table_header") {
                            // 在 Crepe rAF 内被拦截；再套一层 rAF 补 TextSelection
                            const clickPos = cellClickTarget;
                            cellClickTarget = null;
                            requestAnimationFrame(() => {
                                const v = capturedView;
                                if (!v) return;
                                const sel = v.state.selection;
                                if (sel instanceof TextSelection && sel.from === sel.to) return; // 已有光标
                                try {
                                    const p = Math.min(clickPos ?? tr.selection.from, v.state.doc.content.size);
                                    v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(p))));
                                } catch { /* cellClickTarget 位置无效，不修正选区 */ }
                            });
                            return false;
                        }
                    }
                } catch { /* 非表格节点内的 $pos 遍历，忽略 */ }
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

            // 单格 CellSelection → 转 TextSelection
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
                                let aCellStart = -1, hCellStart = -1;
                                for (let d = $a.depth; d >= 0; d--) { if ($a.node(d).type.name === "table_cell" || $a.node(d).type.name === "table_header") { aCellStart = $a.start(d); break; } }
                                for (let d = $h.depth; d >= 0; d--) { if ($h.node(d).type.name === "table_cell" || $h.node(d).type.name === "table_header") { hCellStart = $h.start(d); break; } }
                                if (aCellStart !== hCellStart) return null;
                            } catch { /* 单元格边界检测失败（文档结构变化），回退为单格光标 */ }
                            return newState.tr.setSelection(TextSelection.create(newState.doc, headP, Math.min(pendingClickPos, newState.doc.content.size)));
                        }
                    }
                    return newState.tr.setSelection(TextSelection.near($pos));
                } catch { /* pos 无效（如节点刚被删除），不修正选区 */ return null; }
            }

            return null;
        },
    });
});

// ─── 比较规范化辅助函数 ─────────────────────────────────────────────────────

const SEP_ROW_RE  = /^\|[\s\-:|]+\|$/;
const TABLE_ROW_RE = /^\|.*\|$/;

function normalizeSepRow(line: string): string {
    const t = line.trim();
    const cells = t.split('|').slice(1, -1).map(c => {
        return c.trim().replace(/(:?)-+(:?)/g, (_: string, a: string, b: string) => (a ?? '') + '-' + (b ?? ''));
    });
    return '|' + cells.join('|') + '|';
}

function normalizeSplitStrong(line: string): string {
    let prev: string;
    do {
        prev = line;
        line = line.replace(
            /\*\*((?:[^*]|\*(?!\*))*)\*\* \*\*((?:[^*]|\*(?!\*))*)\*\*/g,
            '**$1 $2**',
        );
    } while (line !== prev);
    return line;
}

function normalizeTableDataRow(line: string): string {
    const t = line.trim();
    const cells = t.split('|').slice(1, -1).map(c => {
        const v = c.trim();
        return v === '<br />' ? '' : v;
    });
    return '|' + cells.join('|') + '|';
}

function normalizeFenceOpen(line: string): string {
    return line.replace(/^(\s*`{3,})\s+/, '$1');
}

function normLineForCompare(line: string): string {
    const t = line.trim();
    if (SEP_ROW_RE.test(t))   return normalizeSepRow(line);
    if (TABLE_ROW_RE.test(t)) return normalizeTableDataRow(line);
    if (/^`{3,}/.test(t))     return normalizeFenceOpen(line);
    return normalizeSplitStrong(line);
}

// ─── 最小化差异合并 ──────────────────────────────────────────────────────────
function applyMinimalChanges(saved: string, serialized: string): string {
    interface SigLine { text: string; lineIdx: number }

    function sigLines(md: string): SigLine[] {
        return md.split('\n').reduce<SigLine[]>((acc, line, i) => {
            if (line.trim() !== '') acc.push({ text: line, lineIdx: i });
            return acc;
        }, []);
    }

    const savedSig  = sigLines(saved);
    const serialSig = sigLines(serialized);
    const n = savedSig.length, m = serialSig.length;

    const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = 1; i <= n; i++)
        for (let j = 1; j <= m; j++)
            dp[i][j] = normLineForCompare(savedSig[i - 1].text) === normLineForCompare(serialSig[j - 1].text)
                ? dp[i - 1][j - 1] + 1
                : Math.max(dp[i - 1][j], dp[i][j - 1]);

    const keepMap = new Map<number, number>();
    {
        let i = n, j = m;
        while (i > 0 && j > 0) {
            if (normLineForCompare(savedSig[i - 1].text) === normLineForCompare(serialSig[j - 1].text)) {
                keepMap.set(serialSig[j - 1].lineIdx, savedSig[i - 1].lineIdx);
                i--; j--;
            } else if (dp[i][j - 1] >= dp[i - 1][j]) {
                j--;
            } else {
                i--;
            }
        }
    }

    if (keepMap.size === n && keepMap.size === m && saved.length === serialized.length) return saved;

    const savedLines = saved.split('\n');
    const serializedLines = serialized.split('\n');
    const result: string[] = [];
    for (let i = 0; i < serializedLines.length; i++) {
        const savedIdx = keepMap.get(i);
        if (savedIdx !== undefined) result.push(savedLines[savedIdx]);
        else result.push(serializedLines[i]);
    }
    return result.join('\n');
}

// ─── 自定义视图组件 ─────────────────────────────────────────

import { createImageView } from "./components/imageView";

// ─── 编辑器实例管理 ──────────────────────────────────────────────────────────

let _editor: Editor | null = null;
let _savedMarkdown = '';
let _hasUserInteracted = false;
let _interactionListenerAdded = false;

function setupInteractionTracking(): void {
    if (_interactionListenerAdded) return;
    _interactionListenerAdded = true;
    const mark = () => { _hasUserInteracted = true; };
    document.addEventListener('keydown',   mark, { capture: true });
    document.addEventListener('mousedown', mark, { capture: true });
    document.addEventListener('paste',     mark, { capture: true });
    document.addEventListener('drop',      mark, { capture: true });
    document.addEventListener('cut',       mark, { capture: true });
}

export function getEditorView(): EditorView | null {
    if (!_editor) return null;
    return _editor.action((ctx) => ctx.get(editorViewCtx));
}

export async function createEditor(
    container: HTMLElement,
    initialMarkdown: string,
    onUpdate: (markdown: string) => void,
    onRenameImage?: (webviewUri: string, newBasename: string) => Promise<void>,
    onTocToggle?: () => void,
): Promise<Editor> {
    _hasUserInteracted = false;
    setupInteractionTracking();

    let debounceTimer: ReturnType<typeof setTimeout>;
    let isComposing = false;
    let pendingMd: string | null = null;

    const fireUpdate = (md: string) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => onUpdate(md), 300);
    };
    const debouncedUpdate = (md: string) => {
        if (isComposing) { pendingMd = md; return; }
        fireUpdate(md);
    };

    container.addEventListener('compositionstart', () => { isComposing = true; });
    container.addEventListener('compositionend', () => {
        isComposing = false;
        if (pendingMd !== null) {
            const md = pendingMd;
            pendingMd = null;
            fireUpdate(md);
        }
    });

    let isSettled = false;

    // ── CrepeBuilder ──────────────────────────────────────────────────────────
    const crepe = new CrepeBuilder({
        root: container,
        defaultValue: initialMarkdown,
    });

    // Phase 3: 启用 Crepe 原生功能（替换自定义实现 + 新增能力）
    // ── 主题切换总线 ────────────────────────────────────────
    const cmTheme = new Compartment();
    const getCMTheme = (dark: boolean) => dark ? oneDark : syntaxHighlighting(defaultHighlightStyle);

    const reconfigureAllCM = () => {
        document.querySelectorAll(".cm-editor").forEach((el) => {
            const v = CMEditorView.findFromDOM(el as HTMLElement);
            if (v) v.dispatch({ effects: cmTheme.reconfigure(getCMTheme(isDark)) });
        });
    };

    // 监听新 CodeMirror 编辑器创建（补配主题）
    const cmObserver = new MutationObserver(() => {
        if (document.querySelector(".cm-editor")) setTimeout(reconfigureAllCM, 10);
    });
    cmObserver.observe(container, { childList: true, subtree: true });

    // 主题切换：CodeMirror + Mermaid 全部统一处理
    // ─── Callout Plugin ──────────────────────────────────────────
    const calloutPluginKey = new PluginKey("callout_decorations");
    const calloutPlugin = $prose(() => {
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
                                const match = text.match(/^\[!(NOTE|INFO|TIP|WARNING|CAUTION|DANGER|SUCCESS|IMPORTANT)\]\s*/i);
                                if (match) {
                                    const rawType = match[1].toLowerCase();
                                    const type = rawType === "info" ? "note" : rawType === "danger" ? "caution" : rawType;
                                    decos.push(
                                        Decoration.node(pos, pos + node.nodeSize, {
                                            class: `callout callout-${type}`,
                                        })
                                    );
                                    const tagLen = match[0].length;
                                    decos.push(
                                        Decoration.inline(pos + 2, pos + 2 + tagLen, {
                                            class: `callout-tag-hidden`,
                                        })
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

    // ─── Mark Highlight Plugin (<mark style="...">...</mark>) ─────
    const markHighlightPluginKey = new PluginKey("mark_highlight_decorations");
    const markHighlightPlugin = $prose(() => {
        return new Plugin({
            key: markHighlightPluginKey,
            props: {
                decorations(state) {
                    const decos: Decoration[] = [];
                    state.doc.descendants((node, pos) => {
                        if (node.isText) {
                            const text = node.text || "";
                            const markRegex = /<mark(?:\s+style=["'](?:background(?:-color)?:\s*([^;"']+))[^"']*["'])?>([\s\S]*?)<\/mark>/gi;
                            let match: RegExpExecArray | null;
                            while ((match = markRegex.exec(text)) !== null) {
                                const fullMatch = match[0];
                                const bgColor = match[1] || "rgba(250, 204, 21, 0.45)";
                                const openTagMatch = fullMatch.match(/^<mark(?:\s+style=["'][^"']*["'])?>/i);
                                const openTagLen = openTagMatch ? openTagMatch[0].length : 6;
                                const closeTagLen = 7; // </mark>

                                const matchStart = pos + match.index;
                                const contentStart = matchStart + openTagLen;
                                const contentEnd = matchStart + fullMatch.length - closeTagLen;
                                const matchEnd = matchStart + fullMatch.length;

                                if (contentStart < contentEnd) {
                                    // Ẩn thẻ mở <mark ...>
                                    decos.push(Decoration.inline(matchStart, contentStart, { class: "mark-tag-hidden" }));
                                    // Tô màu nội dung bên trong
                                    decos.push(
                                        Decoration.inline(contentStart, contentEnd, {
                                            class: "text-highlight-inline",
                                            style: `background-color: ${bgColor};`,
                                        })
                                    );
                                    // Ẩn thẻ đóng </mark>
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

    // ─── Video Decoration Plugin (Iframe & Video Embeds) ─────────
    const videoPluginKey = new PluginKey("video_decorations");
    const videoDecorationPlugin = $prose(() => {
        return new Plugin({
            key: videoPluginKey,
            props: {
                decorations(state) {
                    const decos: Decoration[] = [];
                    state.doc.descendants((node, pos) => {
                        if (node.type.name === "code_block") return;

                        const text = (
                            (node.attrs?.value as string) ||
                            (node.attrs?.html as string) ||
                            (node.attrs?.src as string) ||
                            node.text ||
                            node.textContent ||
                            ""
                        ).trim();
                        if (!text) return;

                        // 1. YouTube Link (standalone URL, iframe, or formatted)
                        const ytMatch = text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([\w-]{11})/i);
                        if (ytMatch) {
                            const videoId = ytMatch[1];
                            const widget = document.createElement("div");
                            widget.className = "embedded-video-container";
                            widget.dataset.videoId = videoId;
                            widget.innerHTML = `
                                <div class="video-toolbar-bar">
                                    <div class="video-toolbar-title">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="#ff0000" style="vertical-align:middle;margin-right:6px"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                                        <span>YouTube Player (${videoId})</span>
                                    </div>
                                    <div class="video-toolbar-actions">
                                        <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" class="video-action-btn" title="Mở trên YouTube">🌐 Mở tab mới</a>
                                    </div>
                                </div>
                                <div class="video-iframe-wrapper">
                                    <iframe 
                                        src="https://www.youtube.com/embed/${videoId}" 
                                        title="YouTube video player" 
                                        frameborder="0" 
                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                                        allowfullscreen>
                                    </iframe>
                                </div>
                            `;
                            decos.push(Decoration.widget(pos + 1, widget, { side: -1 }));
                            if (node.nodeSize > 2) {
                                decos.push(Decoration.inline(pos + 1, pos + node.nodeSize - 1, { class: "video-source-text-hidden" }));
                            }
                            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "video-block-node" }));
                            return;
                        }

                        // 2. Generic <iframe ... src="...">
                        const iframeMatch = text.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
                        if (iframeMatch) {
                            const src = iframeMatch[1];
                            const widget = document.createElement("div");
                            widget.className = "embedded-video-container";
                            widget.innerHTML = `
                                <div class="video-iframe-wrapper">
                                    <iframe src="${src}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
                                </div>
                            `;
                            decos.push(Decoration.widget(pos + 1, widget, { side: -1 }));
                            if (node.nodeSize > 2) {
                                decos.push(Decoration.inline(pos + 1, pos + node.nodeSize - 1, { class: "video-source-text-hidden" }));
                            }
                            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "video-block-node" }));
                            return;
                        }

                        // 3. Generic <video ... src="...">
                        const videoMatch = text.match(/<video[^>]*\ssrc=["']([^"']+)["']/i);
                        if (videoMatch) {
                            const src = videoMatch[1];
                            const widget = document.createElement("div");
                            widget.className = "embedded-video-container";
                            widget.innerHTML = `
                                <div class="video-iframe-wrapper">
                                    <video src="${src}" controls></video>
                                </div>
                            `;
                            decos.push(Decoration.widget(pos + 1, widget, { side: -1 }));
                            if (node.nodeSize > 2) {
                                decos.push(Decoration.inline(pos + 1, pos + node.nodeSize - 1, { class: "video-source-text-hidden" }));
                            }
                            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "video-block-node" }));
                            return;
                        }
                    });
                    return DecorationSet.create(state.doc, decos);
                },
            },
        });
    });

    // ─── Highlight Color Palette Popover ─────────────────────────
    function showHighlightColorPalette(anchorEl: HTMLElement | null, ctx: Ctx) {
        const existing = document.querySelector(".highlight-color-picker-popover");
        if (existing) {
            existing.remove();
            return;
        }

        const popover = document.createElement("div");
        popover.className = "highlight-color-picker-popover";

        const colors = [
            { label: "Vàng (Yellow)", color: "rgba(250, 204, 21, 0.45)", hex: "#fde047" },
            { label: "Xanh lá (Green)", color: "rgba(74, 222, 128, 0.45)", hex: "#4ade80" },
            { label: "Xanh dương (Blue)", color: "rgba(96, 165, 250, 0.45)", hex: "#60a5fa" },
            { label: "Hồng (Pink)", color: "rgba(244, 114, 182, 0.45)", hex: "#f472b6" },
            { label: "Tím (Purple)", color: "rgba(192, 132, 252, 0.45)", hex: "#c084fc" },
            { label: "Cam (Orange)", color: "rgba(251, 146, 60, 0.45)", hex: "#fb923c" },
            { label: "Đỏ (Red)", color: "rgba(248, 113, 113, 0.45)", hex: "#f87171" },
        ];

        const swatchesHtml = colors
            .map(
                (c) =>
                    `<button type="button" class="hl-color-swatch" data-color="${c.color}" title="${c.label}" style="background-color: ${c.hex};"></button>`
            )
            .join("");

        popover.innerHTML = `
            <div class="hl-swatches-title">Chọn màu Highlight</div>
            <div class="hl-swatches">${swatchesHtml}</div>
            <div class="hl-custom-row">
                <label class="hl-custom-label">
                    <input type="color" class="hl-custom-input" value="#fde047" title="Tự chọn màu tùy ý" />
                    <span>Tùy chọn</span>
                </label>
                <button type="button" class="hl-clear-btn" title="Bỏ Highlight">🚫 Xóa</button>
            </div>
        `;

        document.body.appendChild(popover);

        if (anchorEl) {
            const rect = anchorEl.getBoundingClientRect();
            popover.style.top = `${rect.bottom + 6}px`;
            popover.style.left = `${Math.max(10, Math.min(window.innerWidth - 240, rect.left - 40))}px`;
        } else {
            popover.style.top = `60px`;
            popover.style.left = `50%`;
            popover.style.transform = `translateX(-50%)`;
        }

        const apply = (color: string | null) => {
            const view = ctx.get(editorViewCtx);
            const { state } = view;
            const { from, to, empty } = state.selection;

            if (empty) {
                if (color) {
                    const text = `<mark style="background-color: ${color};">highlight</mark>`;
                    const tr = state.tr.insertText(text, from, to);
                    view.dispatch(tr);
                }
            } else {
                const rawText = state.doc.textBetween(from, to);
                const cleaned = rawText.replace(/<mark(?:\s+[^>]*)?>|<\/mark>/gi, "");
                const replacement = color ? `<mark style="background-color: ${color};">${cleaned}</mark>` : cleaned;
                const tr = state.tr.insertText(replacement, from, to);
                view.dispatch(tr);
            }
            view.focus();
            close();
        };

        popover.querySelectorAll(".hl-color-swatch").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const color = (btn as HTMLElement).dataset.color || null;
                apply(color);
            });
        });

        const customInput = popover.querySelector<HTMLInputElement>(".hl-custom-input");
        customInput?.addEventListener("change", (e) => {
            e.stopPropagation();
            const hex = customInput.value;
            apply(hex);
        });

        popover.querySelector(".hl-clear-btn")?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            apply(null);
        });

        const close = () => {
            document.removeEventListener("click", onDocClick);
            document.removeEventListener("keydown", onKeyDown);
            if (popover.parentNode) popover.parentNode.removeChild(popover);
        };

        const onDocClick = (e: MouseEvent) => {
            if (!popover.contains(e.target as Node) && e.target !== anchorEl && !anchorEl?.contains(e.target as Node)) {
                close();
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };

        setTimeout(() => {
            document.addEventListener("click", onDocClick);
            document.addEventListener("keydown", onKeyDown);
        }, 10);
    }

    // ─── Video & YouTube Prompt Dialog ───────────────────────────
    function promptVideoInsert(type: "youtube" | "video", ctx: Ctx) {
        const overlay = document.createElement("div");
        overlay.className = "video-prompt-modal";

        const isYT = type === "youtube";
        const titleText = isYT ? "🎥 Chèn YouTube Video" : "🎬 Chèn Video";
        const placeholderText = isYT
            ? "Dán link YouTube (ví dụ: https://www.youtube.com/watch?v=... hoặc https://youtu.be/...)"
            : "Dán đường dẫn Video (MP4, WebM, URL...)";

        overlay.innerHTML = `
            <div class="video-prompt-backdrop"></div>
            <div class="video-prompt-dialog">
                <div class="video-prompt-header">
                    <div class="video-prompt-title">${titleText}</div>
                    <button class="video-prompt-close">✕</button>
                </div>
                <div class="video-prompt-body">
                    <input type="text" class="video-prompt-input" placeholder="${placeholderText}" />
                    <div class="video-prompt-tip">${isYT ? "Hỗ trợ link video, Shorts, hoặc mã nhúng" : "Hỗ trợ link trực tiếp hoặc file video"}</div>
                </div>
                <div class="video-prompt-footer">
                    <button class="video-prompt-cancel">Hủy</button>
                    <button class="video-prompt-confirm">Chèn Video</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        const input = overlay.querySelector<HTMLInputElement>(".video-prompt-input")!;
        input.focus();

        const close = () => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        };

        const confirm = () => {
            const url = input.value.trim();
            if (!url) { close(); return; }

            const view = ctx.get(editorViewCtx);
            let insertHtml = "";
            if (isYT) {
                let videoId = "";
                const matchYt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
                if (matchYt) {
                    videoId = matchYt[1];
                } else if (/^[\w-]{11}$/.test(url)) {
                    videoId = url;
                }
                if (videoId) {
                    insertHtml = `<iframe width="100%" height="380" src="https://www.youtube.com/embed/${videoId}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>\n\n`;
                } else {
                    insertHtml = `<iframe width="100%" height="380" src="${url}" frameborder="0" allowfullscreen></iframe>\n\n`;
                }
            } else {
                insertHtml = `<video controls width="100%" src="${url}"></video>\n\n`;
            }

            const { from, to } = view.state.selection;
            const tr = view.state.tr.insertText(insertHtml, from, to);
            view.dispatch(tr);
            view.focus();
            close();
        };

        overlay.querySelector(".video-prompt-close")?.addEventListener("click", close);
        overlay.querySelector(".video-prompt-cancel")?.addEventListener("click", close);
        overlay.querySelector(".video-prompt-confirm")?.addEventListener("click", confirm);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); confirm(); }
            if (e.key === "Escape") { e.preventDefault(); close(); }
        });
        overlay.querySelector(".video-prompt-backdrop")?.addEventListener("click", close);
    }

    // ─── Mermaid Lightbox Zoom & Pan Modal ────────────────────────
    function showMermaidZoomModal(svgContent: string, rawCode: string) {
        const modal = document.createElement("div");
        modal.className = "mermaid-zoom-modal";

        let scale = 1;
        let translateX = 0;
        let translateY = 0;
        let isDragging = false;
        let startX = 0;
        let startY = 0;

        modal.innerHTML = `
            <div class="mermaid-zoom-backdrop"></div>
            <div class="mermaid-zoom-dialog">
                <div class="mermaid-zoom-header">
                    <div class="mermaid-zoom-title">📊 Mermaid Diagram (Phóng to & Kéo xem)</div>
                    <div class="mermaid-zoom-actions">
                        <button class="mzm-btn mzm-zoom-in" title="Phóng to (+)">➕ Phóng to</button>
                        <button class="mzm-btn mzm-zoom-out" title="Thu nhỏ (-)">➖ Thu nhỏ</button>
                        <button class="mzm-btn mzm-zoom-reset" title="Mặc định (100%)">1:1</button>
                        <button class="mzm-btn mzm-copy" title="Copy Mermaid Code">📋 Copy Code</button>
                        <button class="mzm-btn mzm-close" title="Đóng (Esc)">✕</button>
                    </div>
                </div>
                <div class="mermaid-zoom-viewport">
                    <div class="mermaid-zoom-content">${svgContent}</div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        const contentEl = modal.querySelector<HTMLElement>(".mermaid-zoom-content")!;
        const viewport = modal.querySelector<HTMLElement>(".mermaid-zoom-viewport")!;

        const updateTransform = () => {
            contentEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        };

        viewport.addEventListener("wheel", (e) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.15 : 0.85;
            scale = Math.min(Math.max(scale * factor, 0.2), 10);
            updateTransform();
        });

        viewport.addEventListener("mousedown", (e) => {
            if ((e.target as HTMLElement).closest(".mzm-btn")) return;
            isDragging = true;
            startX = e.clientX - translateX;
            startY = e.clientY - translateY;
            viewport.style.cursor = "grabbing";
        });

        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            translateX = e.clientX - startX;
            translateY = e.clientY - startY;
            updateTransform();
        };

        const onMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                viewport.style.cursor = "grab";
            }
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        modal.querySelector(".mzm-zoom-in")?.addEventListener("click", () => {
            scale = Math.min(scale * 1.25, 10);
            updateTransform();
        });

        modal.querySelector(".mzm-zoom-out")?.addEventListener("click", () => {
            scale = Math.max(scale * 0.8, 0.2);
            updateTransform();
        });

        modal.querySelector(".mzm-zoom-reset")?.addEventListener("click", () => {
            scale = 1;
            translateX = 0;
            translateY = 0;
            updateTransform();
        });

        const copyBtn = modal.querySelector<HTMLButtonElement>(".mzm-copy");
        copyBtn?.addEventListener("click", () => {
            navigator.clipboard.writeText(rawCode).then(() => {
                copyBtn.textContent = "✓ Copied!";
                setTimeout(() => { copyBtn.textContent = "📋 Copy Code"; }, 1500);
            });
        });

        const close = () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            document.removeEventListener("keydown", onKeyDown);
            if (modal.parentNode) modal.parentNode.removeChild(modal);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                close();
            }
        };
        document.addEventListener("keydown", onKeyDown);

        modal.querySelector(".mzm-close")?.addEventListener("click", close);
        modal.querySelector(".mermaid-zoom-backdrop")?.addEventListener("click", close);
    }

    // 主题切换：CodeMirror + Mermaid 全部统一处理
    let isDark = true;
    const mermaidCodeMap = new Map<string, string>();
    let mermaidSeq = 0;

    const renderMermaid = (code: string): Promise<string> => {
        const id = "mermaid-" + Math.random().toString(36).slice(2, 8);
        return mermaid.render(id, code).then(({ svg }) => svg);
    };

    onThemeChange((dark) => {
        isDark = dark;
        mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default" });
        // 重绘已有 mermaid 预览
        mermaidCodeMap.forEach((code, key) => {
            const el = document.querySelector<HTMLElement>(`[data-mermaid-key="${key}"]`);
            if (el) {
                renderMermaid(code).then((svg) => {
                    const svgTarget = el.querySelector<HTMLElement>(".mermaid-rendered-svg") || el;
                    svgTarget.innerHTML = svg;
                }).catch(() => {});
            }
        });
        // 重配 CodeMirror
        reconfigureAllCM();
    });

    // Mermaid 预览渲染
    const renderPreview = (lang: string, code: string, apply: (v: string | null) => void) => {
        if (lang.toLowerCase() !== "mermaid") return null;
        const key = `m-${++mermaidSeq}`;
        mermaidCodeMap.set(key, code);
        apply(`
            <div class="mermaid-block-wrapper" data-mermaid-key="${key}">
                <div class="mermaid-actions-bar">
                    <button class="mermaid-action-btn mermaid-action-zoom" title="Phóng to sơ đồ">🔍 Phóng to</button>
                    <button class="mermaid-action-btn mermaid-action-copy" title="Copy mã nguồn Mermaid">📋 Copy</button>
                </div>
                <div class="mermaid-rendered-svg"></div>
            </div>
        `);
        const el = () => document.querySelector(`[data-mermaid-key="${key}"]`);
        renderMermaid(code).then((svg) => {
            const container = el();
            if (container) {
                const svgTarget = container.querySelector<HTMLElement>(".mermaid-rendered-svg");
                if (svgTarget) {
                    svgTarget.innerHTML = svg;
                    svgTarget.style.cursor = "pointer";
                    svgTarget.title = "Nhấp đúp để phóng to";
                    svgTarget.addEventListener("dblclick", () => {
                        showMermaidZoomModal(svg, code);
                    });
                }
                const zoomBtn = container.querySelector<HTMLButtonElement>(".mermaid-action-zoom");
                zoomBtn?.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showMermaidZoomModal(svg, code);
                });
                const copyBtn = container.querySelector<HTMLButtonElement>(".mermaid-action-copy");
                copyBtn?.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigator.clipboard.writeText(code).then(() => {
                        copyBtn.textContent = "✓ Copied";
                        setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 1500);
                    });
                });
            }
        }).catch((err) => {
            console.warn('[mermaid] render failed:', err);
            const container = el();
            if (container) {
                const svgTarget = container.querySelector<HTMLElement>(".mermaid-rendered-svg");
                if (svgTarget) svgTarget.innerHTML = `<span style="color:var(--vscode-errorForeground)">Mermaid: ${err}</span>`;
            }
        });
    };

    crepe
        .addFeature(codeMirror, {
            languages: codeLanguages,
            theme: cmTheme.of(getCMTheme()),
            renderPreview,
            searchPlaceholder: t('Search language...'),
        })
        .addFeature(cursor) // 原版虚拟光标（mark 边界方向键/方向指示），z-index 已在 style.css 修复被背景盖住问题
        .addFeature(listItem)
        .addFeature(blockEdit, {
            textGroup: {
                label: t('Text'),
                text: { label: t('Text'), icon: '' },
                h1: { label: t('Heading 1'), icon: '' },
                h2: { label: t('Heading 2'), icon: '' },
                h3: { label: t('Heading 3'), icon: '' },
                h4: { label: t('Heading 4'), icon: '' },
                h5: { label: t('Heading 5'), icon: '' },
                h6: { label: t('Heading 6'), icon: '' },
                quote: { label: t('Quote'), icon: '' },
                divider: { label: t('Divider'), icon: '' },
            },
            listGroup: {
                label: t('Lists'),
                bulletList: { label: t('Bullet list'), icon: '' },
                orderedList: { label: t('Numbered list'), icon: '' },
                taskList: { label: t('Task list'), icon: '' },
            },
            advancedGroup: {
                label: t('Advanced'),
                image: { label: t('Image'), icon: '' },
                codeBlock: { label: t('Code block'), icon: '' },
                table: { label: t('Table'), icon: '' },
                math: { label: t('Math formula'), icon: '' },
            },
            buildMenu: (builder) => {
                // ─── Callout Ghi chú 5 loại ───
                const calloutGroup = builder.addGroup('callouts', 'Callouts & Alerts');
                const addCallout = (id: string, label: string, tag: string, iconText: string) => {
                    calloutGroup.addItem(id, {
                        label,
                        icon: `<svg width="20" height="20" viewBox="0 0 24 24"><text x="2" y="17" font-size="16">${iconText}</text></svg>`,
                        onRun: (ctx) => {
                            const commands = ctx.get(commandsCtx);
                            const view = ctx.get(editorViewCtx);
                            commands.call(clearTextInCurrentBlockCommand.key);
                            const bq = view.state.schema.nodes.blockquote;
                            const p = view.state.schema.nodes.paragraph;
                            if (!bq || !p) return;
                            const text = view.state.schema.text(`[!${tag}] `);
                            const calloutNode = bq.create(null, p.create(null, text));
                            const tr = view.state.tr.replaceSelectionWith(calloutNode);
                            view.dispatch(tr);
                        },
                    });
                };

                addCallout('callout-note', 'Note / Info', 'NOTE', 'ℹ️');
                addCallout('callout-tip', 'Tip', 'TIP', '💡');
                addCallout('callout-warning', 'Warning', 'WARNING', '⚠️');
                addCallout('callout-caution', 'Danger / Caution', 'CAUTION', '🛑');
                addCallout('callout-success', 'Success', 'SUCCESS', '✅');

                // ─── Media & Video ───
                const mediaGroup = builder.addGroup('media', 'Media & Embeds');
                mediaGroup.addItem('youtube-video', {
                    label: 'YouTube Video',
                    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
                    onRun: (ctx) => {
                        const commands = ctx.get(commandsCtx);
                        commands.call(clearTextInCurrentBlockCommand.key);
                        promptVideoInsert('youtube', ctx);
                    },
                });
                mediaGroup.addItem('custom-video', {
                    label: 'Video Player',
                    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`,
                    onRun: (ctx) => {
                        const commands = ctx.get(commandsCtx);
                        commands.call(clearTextInCurrentBlockCommand.key);
                        promptVideoInsert('video', ctx);
                    },
                });
                mediaGroup.addItem('mermaid-diagram', {
                    label: 'Mermaid Diagram',
                    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><line x1="9" y1="6" x2="15" y2="6"/><line x1="6" y1="9" x2="18" y2="15"/></svg>`,
                    onRun: (ctx) => {
                        const commands = ctx.get(commandsCtx);
                        const codeBlock = codeBlockSchema.type(ctx);
                        commands.call(clearTextInCurrentBlockCommand.key);
                        commands.call(addBlockTypeCommand.key, {
                            nodeType: codeBlock,
                            attrs: { language: 'mermaid' },
                        });
                    },
                });
                mediaGroup.addItem('highlight-text', {
                    label: 'Highlight (Tô màu văn bản)',
                    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 2-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 0"/><path d="m18 6 3 3"/></svg>`,
                    onRun: (ctx) => {
                        showHighlightColorPalette(null, ctx);
                    },
                });
            },
        })
        .addFeature(topBar, {
            headingOptions: [
                { label: 'P', level: null },
                { label: 'H1', level: 1 },
                { label: 'H2', level: 2 },
                { label: 'H3', level: 3 },
                { label: 'H4', level: 4 },
                { label: 'H5', level: 5 },
                { label: 'H6', level: 6 },
            ],
            buildTopBar: (builder) => {
                // Undo/Redo — 最前面独立组
                builder.addGroup('history', '').addItem('undo', {
                    icon: TbUndo,
                    active: (ctx) => undo(ctx.get(editorViewCtx).state),
                    onRun: (ctx) => { const v = ctx.get(editorViewCtx); undo(v.state, v.dispatch, v); },
                }).addItem('redo', {
                    icon: TbRedo,
                    active: (ctx) => redo(ctx.get(editorViewCtx).state),
                    onRun: (ctx) => { const v = ctx.get(editorViewCtx); redo(v.state, v.dispatch, v); },
                });
                // 清除格式 — formatting 组末尾（行内代码后面）
                builder.getGroup('formatting').addItem('clear-format', {
                    icon: TbEraser,
                    active: (ctx) => {
                        const v = ctx.get(editorViewCtx);
                        const { from, to, empty } = v.state.selection;
                        if (!empty) {
                            let has = false;
                            v.state.doc.nodesBetween(from, to, (n) => { if (n.marks.length) { has = true; return false; } return true; });
                            return has;
                        }
                        // 无选区时：光标在链接内即为 active
                        const linkType = v.state.schema.marks['link'];
                        if (!linkType) return false;
                        return linkType.isInSet(v.state.doc.resolve(from).marks()) !== undefined;
                    },
                    onRun: (ctx) => {
                        const v = ctx.get(editorViewCtx);
                        let { from, to, empty } = v.state.selection;
                        const tr = v.state.tr;
                        const linkType = v.state.schema.marks['link'];

                        // 光标在链接内（无选区）→ 取消整个链接
                        if (empty && linkType) {
                            const $from = v.state.doc.resolve(from);
                            if (linkType.isInSet($from.marks())) {
                                while (from > 0 && v.state.doc.rangeHasMark(from - 1, from, linkType)) from--;
                                const docSize = v.state.doc.content.size;
                                while (to < docSize && v.state.doc.rangeHasMark(to, to + 1, linkType)) to++;
                                tr.removeMark(from, to, linkType);
                                v.dispatch(tr);
                                return;
                            }
                        }

                        // 有选区 → 扩展链接边界后清除所有标记
                        if (linkType) {
                            while (from > 0 && v.state.doc.rangeHasMark(from - 1, from, linkType)) from--;
                            const docSize = v.state.doc.content.size;
                            while (to < docSize && v.state.doc.rangeHasMark(to, to + 1, linkType)) to++;
                        }

                        v.state.doc.nodesBetween(from, to, (n, pos) => {
                            if (n.marks.length) {
                                const s = Math.max(pos, from), e = Math.min(pos + n.nodeSize, to);
                                n.marks.forEach((m) => tr.removeMark(s, e, m.type));
                            }
                        });
                        if (linkType) tr.removeMark(from, to, linkType);
                        v.dispatch(tr);
                    },
                });
                // Highlight Color Palette — formatting 组
                builder.getGroup('formatting').addItem('highlight-color', {
                    icon: TbHighlighter,
                    active: () => false,
                    onRun: (ctx) => {
                        const btn = document.querySelector('[data-key="highlight-color"]') as HTMLElement | null;
                        showHighlightColorPalette(btn, ctx);
                    },
                });
                // 图片 — insert 组，link 和 table 之间（清空后按序重建）
                {
                    const g = builder.getGroup('insert'); const items = g.group.items;
                    const linkItem = items.find((i) => i.key === 'link');
                    const tableItem = items.find((i) => i.key === 'table');
                    g.clear();
                    if (linkItem) g.addItem('link', linkItem);
                    g.addItem('image', {
                        icon: TbImage,
                        active: () => false,
                        onRun: (ctx) => {
                            ctx.get(editorViewCtx).dom.dispatchEvent(new CustomEvent('epytor:insertImage', { bubbles: true }));
                        },
                    });
                    if (tableItem) g.addItem('table', tableItem);
                }
                // 引用块一键退出：在引用内点击 → lift 解包，否则 → 包裹
                {
                    const isInBlockquote = (state: EditorState) => {
                        const bqType = state.schema.nodes['blockquote'];
                        if (!bqType) return false;
                        const { $from } = state.selection;
                        for (let d = $from.depth; d >= 0; d--) {
                            if ($from.node(d).type === bqType) return true;
                        }
                        return false;
                    };

                    const moreG = builder.getGroup('more');
                    const moreItems = moreG.group.items;
                    const quoteItem = moreItems.find((i) => i.key === 'quote');
                    const hrItem = moreItems.find((i) => i.key === 'hr');
                    const quoteIcon = quoteItem?.icon ?? '';
                    moreG.clear();
                    moreG.addItem('quote', {
                        icon: quoteIcon,
                        active: (ctx) => isInBlockquote(ctx.get(editorViewCtx).state),
                        onRun: (ctx) => {
                            const v = ctx.get(editorViewCtx);
                            if (isInBlockquote(v.state)) {
                                lift(v.state, v.dispatch);
                            } else {
                                const bq = v.state.schema.nodes['blockquote'];
                                if (bq) wrapIn(bq)(v.state, v.dispatch);
                            }
                        },
                    });
                    if (hrItem) moreG.addItem('hr', hrItem);
                }
                // 列表切换：不在列表 → 包裹；在列表且类型不同 → 直接切换；类型相同 → 取消列表
                {
                    const findListItems = (state: EditorState) => {
                        const liType = state.schema.nodes['list_item'];
                        const { from, to } = state.selection;
                        const items: Array<{ pos: number; node: any }> = [];
                        state.doc.nodesBetween(from, to, (node, pos) => {
                            if (node.type === liType) items.push({ pos, node });
                        });
                        if (!items.length) {
                            const { $from } = state.selection;
                            for (let d = $from.depth; d >= 0; d--) {
                                if ($from.node(d).type === liType) {
                                    items.push({ pos: $from.before(d), node: $from.node(d) });
                                    break;
                                }
                            }
                        }
                        return items;
                    };
                    // 找到包含这些 list_item 的顶层列表节点（去重）
                    const findTopLists = (state: EditorState, items: Array<{ pos: number; node: any }>) => {
                        const lists: Array<{ pos: number; node: any }> = [];
                        const seen = new Set<number>();
                        items.forEach(({ pos }) => {
                            const $pos = state.doc.resolve(pos);
                            for (let d = $pos.depth; d >= 0; d--) {
                                const node = $pos.node(d);
                                if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
                                    const listPos = $pos.before(d);
                                    if (!seen.has(listPos)) {
                                        seen.add(listPos);
                                        lists.push({ pos: listPos, node });
                                    }
                                    break;
                                }
                            }
                        });
                        return lists;
                    };
                    const listKind = (state: EditorState): 'bullet' | 'ordered' | 'task' | null => {
                        const items = findListItems(state);
                        if (!items.length) return null;
                        const attrs = items[0].node.attrs;
                        if (attrs.checked != null) return 'task';
                        return attrs.listType === 'ordered' ? 'ordered' : 'bullet';
                    };
                    const toggleList = (target: 'bullet' | 'ordered' | 'task') => (ctx: any) => {
                        const v = ctx.get(editorViewCtx);
                        const { state, dispatch } = v;
                        const schema = state.schema;
                        const kind = listKind(state);
                        if (!kind) {
                            // 不在列表 → 原包裹行为
                            let nodeType: any = null;
                            let attrs: any = null;
                            if (target === 'bullet') nodeType = schema.nodes['bullet_list'];
                            else if (target === 'ordered') nodeType = schema.nodes['ordered_list'];
                            else { nodeType = schema.nodes['list_item']; attrs = { checked: false }; }
                            if (nodeType) ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, { nodeType, attrs });
                            return;
                        }
                        if (kind === target) {
                            // 同类型 → 取消/降级（lift 一层）
                            const liType = schema.nodes['list_item'];
                            liftListItem(liType)(state, dispatch);
                            return;
                        }
                        // 不同类型 → 换外层列表类型 + 更新 list_item attrs
                        // 用 setNodeMarkup（不改变节点大小，光标位置自动保留，不会跳行）
                        const items = findListItems(state);
                        const lists = findTopLists(state, items);
                        if (!lists.length) return;
                        const tr = state.tr;
                        lists.forEach(({ pos, node }) => {
                            const newType = target === 'ordered'
                                ? schema.nodes['ordered_list']
                                : schema.nodes['bullet_list'];
                            const newAttrs = { ...node.attrs };
                            if (target === 'ordered') newAttrs.order = 1;
                            // 换外层类型（content 保留）
                            tr.setNodeMarkup(pos, newType, newAttrs);
                            // 逐个 list_item 更新 attrs
                            let order = 1;
                            node.forEach((item: any, _off: number, itemPos: number) => {
                                const itemAttrs = { ...item.attrs };
                                if (target === 'bullet') {
                                    itemAttrs.listType = 'bullet';
                                    itemAttrs.label = '•';
                                    itemAttrs.checked = null;
                                } else if (target === 'ordered') {
                                    itemAttrs.listType = 'ordered';
                                    itemAttrs.label = `${order}.`;
                                    itemAttrs.checked = null;
                                    order++;
                                } else { // task
                                    itemAttrs.checked = false;
                                    itemAttrs.listType = 'bullet';
                                    itemAttrs.label = '•';
                                }
                                tr.setNodeMarkup(pos + itemPos + 1, undefined, itemAttrs);
                            });
                        });
                        dispatch(tr);
                    };
                    const listG = builder.getGroup('list');
                    const listItems = listG.group.items;
                    const bulletItem = listItems.find((i: any) => i.key === 'bullet-list');
                    const orderedItem = listItems.find((i: any) => i.key === 'ordered-list');
                    const taskItem = listItems.find((i: any) => i.key === 'task-list');
                    if (bulletItem || orderedItem || taskItem) {
                        listG.clear();
                        if (bulletItem) listG.addItem('bullet-list', {
                            icon: bulletItem.icon,
                            active: (c: any) => listKind(c.get(editorViewCtx).state) === 'bullet',
                            onRun: toggleList('bullet'),
                        });
                        if (orderedItem) listG.addItem('ordered-list', {
                            icon: orderedItem.icon,
                            active: (c: any) => listKind(c.get(editorViewCtx).state) === 'ordered',
                            onRun: toggleList('ordered'),
                        });
                        if (taskItem) listG.addItem('task-list', {
                            icon: taskItem.icon,
                            active: (c: any) => listKind(c.get(editorViewCtx).state) === 'task',
                            onRun: toggleList('task'),
                        });
                    }
                }
                // 目录切换 — 设置前独立组
                builder.addGroup('toc', '').addItem('toc', {
                    icon: TbToc,
                    active: () => false,
                    onRun: () => {
                        onTocToggle?.();
                    },
                });
                // 设置 — 末尾独立组
                builder.addGroup('settings', '').addItem('settings', {
                    icon: TbGear,
                    active: () => false,
                    onRun: () => {
                        document.dispatchEvent(new CustomEvent('epytor:openSettings', { bubbles: true }));
                    },
                });
                // 将 toc、history 组移到最前面
                const groups = builder.build();
                const tocGroup = groups.find((g) => g.key === 'toc');
                if (tocGroup) {
                    const idx = groups.indexOf(tocGroup);
                    groups.splice(idx, 1);
                    groups.unshift(tocGroup);
                }
                const historyGroup = groups.find((g) => g.key === 'history');
                if (historyGroup) {
                    const idx = groups.indexOf(historyGroup);
                    groups.splice(idx, 1);
                    groups.splice(1, 0, historyGroup);
                }
            },
        })
        .addFeature(toolbar)
        .addFeature(table)
        .addFeature(latex)       // 全新：KaTeX 数学公式
        .addFeature(linkTooltip)
    // 已启用：feature/toolbar → 选中文字浮动工具栏

    // 注入保留的自定义配置
    crepe.editor
        .config((ctx) => {
            _savedMarkdown = initialMarkdown;

            // 注册自定义 image NodeView
            ctx.set(nodeViewCtx, [
                [
                    "image",
                    (node, view, getPos) =>
                        createImageView(node, view, getPos, undefined, undefined, onRenameImage),
                ],
            ]);

        })
        .use(listener)              // 追加 listener 用于 markdownUpdated
        .use(calloutPlugin)         // Callouts 5 loại (Note, Tip, Warning, Danger, Success)
        .use(markHighlightPlugin)   // Mark Text Highlights
        .use(videoDecorationPlugin) // Video & YouTube Embeds
        .use(listLiftPlugin)        // 保留：列表 backspace
        .use(selectionPlugin)       // 保留：选区变更回调
        .use(formatKeymapPlugin)    // 保留：自定义格式化快捷键
        .use(cellClickFixPlugin)    // 表格单击→光标定位，拖拽→多选
        .use(listSpreadNormalizePlugin); // 保留：列表 spread 规范化

    // 注册 markdownUpdated 回调（自动保存链路）
    crepe.on((api) => {
        api.markdownUpdated((_ctx, markdown) => {
            if (!isSettled) return;
            if (!_hasUserInteracted) return;
            const toSave = applyMinimalChanges(_savedMarkdown, markdown);
            if (toSave === _savedMarkdown) return;
            _savedMarkdown = toSave;
            debouncedUpdate(toSave);
        });
    });

    _editor = await crepe.create();
    isSettled = true;
    return _editor;
}
