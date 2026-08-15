import {
    commandsCtx,
    Editor,
    editorViewCtx,
    nodeViewCtx,
    schemaCtx,
} from "@milkdown/kit/core";
import {
    wrapInBlockTypeCommand,
    clearTextInCurrentBlockCommand,
    codeBlockSchema,
    addBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";
import { listener } from "@milkdown/kit/plugin/listener";
import type { EditorView } from "@milkdown/kit/prose/view";
import { undo, redo } from "@milkdown/kit/prose/history";
import { TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import { liftListItem } from "@milkdown/kit/prose/schema-list";
import { lift, wrapIn } from "prosemirror-commands";
import type { Ctx } from "@milkdown/kit/ctx";
import { CrepeBuilder } from "@milkdown/crepe";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";
import { blockEdit } from "@milkdown/crepe/feature/block-edit";
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
import { defaultHighlightStyle, syntaxHighlighting, LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages as allCodeLanguages } from "@codemirror/language-data";
import mermaid from "mermaid";
import { onThemeChange } from "./utils/themeBus";
import { t } from "./i18n";
import { TbUndo, TbRedo, TbImage, TbEraser, TbGear, TbToc, TbHighlighter } from "./ui/icons";

// ─── Plugins ────────────────────────────────────────────────────────────────
import { calloutPlugin } from "./plugins/calloutPlugin";
import { markHighlightPlugin } from "./plugins/markHighlightPlugin";
import { videoDecorationPlugin } from "./plugins/videoDecorationPlugin";
import { cellClickFixPlugin } from "./plugins/cellClickFixPlugin";
import { listSpreadNormalizePlugin } from "./plugins/listSpreadNormalizePlugin";
import { listLiftPlugin } from "./plugins/listLiftPlugin";
import { formatKeymapPlugin } from "./plugins/formatKeymapPlugin";
import { selectionPlugin, registerSelectionChangeHandler } from "./plugins/selectionPlugin";

// ─── Modals ─────────────────────────────────────────────────────────────────
import { showMermaidZoomModal } from "./ui/modals/mermaidZoomModal";
import { promptVideoInsert } from "./ui/modals/videoPromptDialog";
import { showHighlightColorPalette } from "./ui/modals/highlightColorPicker";
import { createImageView } from "./components/imageView";

export { registerSelectionChangeHandler };

// 调试日志开关
let logTableSel = false;
export function setLogTableSel(enabled: boolean): void {
    logTableSel = enabled;
}

// 只保留常用语言（143 → ~40）
const WANTED_LANGS = new Set([
    "bash", "sh", "c", "cpp", "c++", "csharp", "c#", "css", "go", "html",
    "java", "javascript", "js", "json", "kotlin", "latex", "less", "lua",
    "markdown", "md", "mermaid", "php", "python", "py", "ruby", "rust",
    "sass", "scss", "sql", "swift", "toml", "typescript", "ts", "xml", "yaml", "yml",
]);
const codeLanguages = allCodeLanguages.filter(
    (l) => l.alias.some((a) => WANTED_LANGS.has(a))
);
// Mermaid 不在 @codemirror/language-data 中，手动添加
codeLanguages.unshift(
    LanguageDescription.of({
        name: "Text",
        alias: ["text", "plaintext", "txt"],
        extensions: ["txt"],
        load: async () => undefined as unknown as LanguageSupport,
    })
);
codeLanguages.push(
    LanguageDescription.of({
        name: "Mermaid",
        alias: ["mermaid"],
        extensions: ["mmd"],
        load: async () => undefined as unknown as LanguageSupport,
    })
);

// ─── 比较规范化辅助函数 ─────────────────────────────────────────────────────
const SEP_ROW_RE = /^\|[\s\-:|]+\|$/;
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
    if (SEP_ROW_RE.test(t)) return normalizeSepRow(line);
    if (TABLE_ROW_RE.test(t)) return normalizeTableDataRow(line);
    if (/^`{3,}/.test(t)) return normalizeFenceOpen(line);
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

    const savedSig = sigLines(saved);
    const serialSig = sigLines(serialized);
    const n = savedSig.length, m = serialSig.length;

    // Fast-path for unchanged or empty documents
    if (n === 0 && m === 0) return serialized;
    if (n > 2000 || m > 2000) {
        // For very large documents, bypass heavy DP grid to avoid frame drops
        return serialized;
    }

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

// ─── 编辑器实例管理 ──────────────────────────────────────────────────────────
let _editor: Editor | null = null;
let _savedMarkdown = '';
let _hasUserInteracted = false;
let _interactionListenerAdded = false;

function setupInteractionTracking(): void {
    if (_interactionListenerAdded) return;
    _interactionListenerAdded = true;
    const mark = () => { _hasUserInteracted = true; };
    document.addEventListener('keydown', mark, { capture: true });
    document.addEventListener('mousedown', mark, { capture: true });
    document.addEventListener('paste', mark, { capture: true });
    document.addEventListener('drop', mark, { capture: true });
    document.addEventListener('cut', mark, { capture: true });
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

    const cmTheme = new Compartment();
    const getCMTheme = (dark?: boolean) => {
        const isDarkTheme = dark ?? isDark;
        return isDarkTheme ? oneDark : syntaxHighlighting(defaultHighlightStyle);
    };

    const reconfigureAllCM = () => {
        document.querySelectorAll(".cm-editor").forEach((el) => {
            const v = CMEditorView.findFromDOM(el as HTMLElement);
            if (v) v.dispatch({ effects: cmTheme.reconfigure(getCMTheme(isDark)) });
        });
    };

    const cmObserver = new MutationObserver(() => {
        if (document.querySelector(".cm-editor")) setTimeout(reconfigureAllCM, 10);
    });
    cmObserver.observe(container, { childList: true, subtree: true });

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
        mermaidCodeMap.forEach((code, key) => {
            const el = document.querySelector<HTMLElement>(`[data-mermaid-key="${key}"]`);
            if (el) {
                renderMermaid(code).then((svg) => {
                    const svgTarget = el.querySelector<HTMLElement>(".mermaid-rendered-svg") || el;
                    svgTarget.innerHTML = svg;
                }).catch(() => {});
            }
        });
        reconfigureAllCM();
    });

    const renderPreview = (lang: string, code: string, apply: (v: string | null) => void) => {
        if (lang.toLowerCase() !== "mermaid") return null;
        const key = `m-${++mermaidSeq}`;
        mermaidCodeMap.set(key, code);
        // Keep mermaid map bounded to prevent leaks
        if (mermaidCodeMap.size > 200) {
            const firstKey = mermaidCodeMap.keys().next().value;
            if (firstKey) mermaidCodeMap.delete(firstKey);
        }
        apply(`
            <div class="mermaid-block-wrapper" data-mermaid-key="${key}">
                <div class="mermaid-actions-bar">
                    <button class="mermaid-action-btn mermaid-action-zoom" title="Zoom Diagram">🔍 Zoom</button>
                    <button class="mermaid-action-btn mermaid-action-copy" title="Copy Mermaid Code">📋 Copy</button>
                </div>
                <div class="mermaid-rendered-svg"></div>
            </div>
        `);
        const el = () => document.querySelector(`[data-mermaid-key="${key}"]`);
        renderMermaid(code).then((svg) => {
            const containerEl = el();
            if (containerEl) {
                const svgTarget = containerEl.querySelector<HTMLElement>(".mermaid-rendered-svg");
                if (svgTarget) {
                    svgTarget.innerHTML = svg;
                    svgTarget.style.cursor = "pointer";
                    svgTarget.title = "Double-click to zoom diagram";
                    svgTarget.addEventListener("dblclick", () => {
                        showMermaidZoomModal(svg, code);
                    });
                }
                const zoomBtn = containerEl.querySelector<HTMLButtonElement>(".mermaid-action-zoom");
                zoomBtn?.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showMermaidZoomModal(svg, code);
                });
                const copyBtn = containerEl.querySelector<HTMLButtonElement>(".mermaid-action-copy");
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
            const containerEl = el();
            if (containerEl) {
                const svgTarget = containerEl.querySelector<HTMLElement>(".mermaid-rendered-svg");
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
        .addFeature(cursor)
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
                // Callouts Group
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
                            const tagPara = p.create(null, view.state.schema.text(`[!${tag}]`));
                            const contentPara = p.create(null);
                            const calloutNode = bq.create(null, [tagPara, contentPara]);
                            const tr = view.state.tr.replaceSelectionWith(calloutNode);
                            const targetPos = tr.mapping.map(view.state.selection.from) + tagPara.nodeSize + 1;
                            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(targetPos, tr.doc.content.size))));
                            view.dispatch(tr);
                            view.focus();
                        },
                    });
                };

                addCallout('caution', 'Caution / Danger', 'CAUTION', '🛑');
                addCallout('note', 'Note / Info', 'NOTE', 'ℹ️');
                addCallout('tip', 'Tip', 'TIP', '💡');
                addCallout('warning', 'Warning', 'WARNING', '⚠️');
                addCallout('success', 'Success', 'SUCCESS', '✅');
                addCallout('important', 'Important', 'IMPORTANT', '📌');

                // Media & Embeds Group
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
                    label: 'Highlight Text',
                    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 2-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 0"/><path d="m18 6 3 3"/></svg>`,
                    onRun: (ctx) => {
                        showHighlightColorPalette(null, ctx);
                    },
                });
            },
        })
        .addFeature(toolbar, {
            boldLabel: t('Bold'),
            italicLabel: t('Italic'),
            strikethroughLabel: t('Strikethrough'),
            codeLabel: t('Inline code'),
            linkLabel: t('Link'),
            buildToolbar: (builder) => {
                builder.getGroup('formatting').addItem('highlight-color', {
                    icon: TbHighlighter,
                    label: 'Highlight',
                    active: () => false,
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
                // Undo/Redo Group
                builder.addGroup('history', '').addItem('undo', {
                    icon: TbUndo,
                    active: (ctx: Ctx) => undo(ctx.get(editorViewCtx).state),
                    onRun: (ctx: Ctx) => { const v = ctx.get(editorViewCtx); undo(v.state, v.dispatch, v); },
                }).addItem('redo', {
                    icon: TbRedo,
                    active: (ctx: Ctx) => redo(ctx.get(editorViewCtx).state),
                    onRun: (ctx: Ctx) => { const v = ctx.get(editorViewCtx); redo(v.state, v.dispatch, v); },
                });

                // Clear formatting
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
                        const linkType = v.state.schema.marks['link'];
                        if (!linkType) return false;
                        return linkType.isInSet(v.state.doc.resolve(from).marks()) !== undefined;
                    },
                    onRun: (ctx) => {
                        const v = ctx.get(editorViewCtx);
                        let { from, to, empty } = v.state.selection;
                        const tr = v.state.tr;
                        const linkType = v.state.schema.marks['link'];

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

                // Highlight Color Palette
                builder.getGroup('formatting').addItem('highlight-color', {
                    icon: TbHighlighter,
                    active: () => false,
                    onRun: (ctx) => {
                        const btn = document.querySelector('[data-key="highlight-color"]') as HTMLElement | null;
                        showHighlightColorPalette(btn, ctx);
                    },
                });

                // Image insert button
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

                // Blockquote toggle
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

                // List toggle
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
                            let nodeType: any = null;
                            let attrs: any = null;
                            if (target === 'bullet') nodeType = schema.nodes['bullet_list'];
                            else if (target === 'ordered') nodeType = schema.nodes['ordered_list'];
                            else { nodeType = schema.nodes['list_item']; attrs = { checked: false }; }
                            if (nodeType) ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, { nodeType, attrs });
                            return;
                        }
                        if (kind === target) {
                            const liType = schema.nodes['list_item'];
                            liftListItem(liType)(state, dispatch);
                            return;
                        }
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
                            tr.setNodeMarkup(pos, newType, newAttrs);
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
                                } else {
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

                // TOC toggle
                builder.addGroup('toc', '').addItem('toc', {
                    icon: TbToc,
                    active: () => false,
                    onRun: () => {
                        onTocToggle?.();
                    },
                });

                // Settings
                builder.addGroup('settings', '').addItem('settings', {
                    icon: TbGear,
                    active: () => false,
                    onRun: () => {
                        document.dispatchEvent(new CustomEvent('epytor:openSettings', { bubbles: true }));
                    },
                });

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
        .addFeature(latex)
        .addFeature(linkTooltip);

    crepe.editor
        .config((ctx) => {
            _savedMarkdown = initialMarkdown;
            ctx.set(nodeViewCtx, [
                [
                    "image",
                    (node, view, getPos) =>
                        createImageView(node, view, getPos, undefined, undefined, onRenameImage),
                ],
            ]);
        })
        .use(listener)
        .use(calloutPlugin)
        .use(markHighlightPlugin)
        .use(videoDecorationPlugin)
        .use(listLiftPlugin)
        .use(selectionPlugin)
        .use(formatKeymapPlugin)
        .use(cellClickFixPlugin)
        .use(listSpreadNormalizePlugin);

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
