import "@milkdown/crepe/theme/classic-dark.css";
import "@milkdown/crepe/theme/common/prosemirror.css";
import "@milkdown/crepe/theme/common/reset.css";
import "@milkdown/crepe/theme/common/code-mirror.css";
import "@milkdown/crepe/theme/common/cursor.css";
import "@milkdown/crepe/theme/common/latex.css";
import "@milkdown/crepe/theme/common/list-item.css";
import "@milkdown/crepe/theme/common/table.css";
import "@milkdown/crepe/theme/common/top-bar.css";
import "@milkdown/crepe/theme/common/toolbar.css";
import "@milkdown/crepe/theme/common/link-tooltip.css";
import "./style.css"; // Must be loaded after the Crepe CSS, to override the Crepe theme via VSCode variables
import { DEFAULT_TOPBAR_HEIGHT, VIEWPORT_PADDING } from "../shared/constants";
import {
    createEditor,
    getEditorView,
    registerSelectionChangeHandler,
    setLogTableSel,
} from "./editor";
import type { EditorView } from "@milkdown/kit/prose/view";
import { undo, redo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import {
    notifyReady,
    notifyUpdate,
    onMessage,
    notifySwitchToTextEditor,
    notifyUploadImage,
    notifyGetProjectImages,
    notifyRenameImage,
    notifyWordCount,
    notifyOpenUrl,
    notifyOpenFile,
    notifyOpenSettings,
    getWebviewState,
    setWebviewState,
} from "./messaging";
import { showImagePicker } from "./components/imagePicker";
import { setupPathLink } from "./components/pathLink";
import { initPathComplete, dispatchPathSuggestions } from "./components/pathLink/pathComplete";
import { dispatchImgPathSuggestions, dispatchImagePathResolved } from "./components/imageView/imgPathComplete";
import { setImageUriMap, showGlobalLightbox } from "./components/imageView";
import { initFindBar } from "./components/findBar";
import { initHeadingIds } from "./headingIds";
import { initToc } from "./components/toc";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import { applyTooltip } from "./ui/tooltip";
import { IconMaximize2, IconMinimize2 } from "./ui/icons";
import { t } from "./i18n";

let currentEditor: Editor | null = null;
let currentLineMap: number[] = [];
let _debugLog = false;

// Modifier-key monitor: while Ctrl/Meta is held, add a class to body so link hover shows a pointer cursor
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) document.body.classList.add('epytor-modifier-active');
});
document.addEventListener('keyup', (e) => {
    if (!e.ctrlKey && !e.metaKey) document.body.classList.remove('epytor-modifier-active');
});
window.addEventListener('blur', () => document.body.classList.remove('epytor-modifier-active'));
export function getLineMap(): number[] {
    return currentLineMap;
}

// Store the original markdown content (from init/revert messages, not serialized by Milkdown)
let markdownSource = "";
export function getMarkdownSource(): string {
    return markdownSource;
}

/** Scroll the block corresponding to the source line number (1-indexed) in lineMap to the top of the viewport, with proportional interpolation within the block */
function scrollToSourceLine(view: EditorView, lineMap: number[], targetLine: number): void {
    if (!lineMap.length) { return; }
    let blockIdx = 0;
    for (let i = 0; i < lineMap.length; i++) {
        if (lineMap[i] <= targetLine) { blockIdx = i; }
        else { break; }
    }
    const children = view.dom.children;
    if (blockIdx >= children.length) { return; }
    const el = children[blockIdx] as HTMLElement;
    if (!el) { return; }

    // Within-block proportional interpolation: the proportional position of the target line in the source paragraph → the scroll offset in the corresponding rendered block
    const blockStartLine = lineMap[blockIdx];
    const totalSourceLines = getMarkdownSource().split('\n').length;
    const nextBlockStartLine = blockIdx + 1 < lineMap.length ? lineMap[blockIdx + 1] : totalSourceLines + 1;
    const blockLineCount = nextBlockStartLine - blockStartLine;
    const lineOffset = targetLine - blockStartLine;
    const proportion = blockLineCount > 1 ? Math.min(lineOffset / (blockLineCount - 1), 1) : 0;

    const topbarH = document.querySelector(".milkdown-top-bar")?.getBoundingClientRect().height ?? DEFAULT_TOPBAR_HEIGHT;
    const elRect = el.getBoundingClientRect();
    const scrollTarget = elRect.top + window.scrollY + elRect.height * proportion - topbarH - VIEWPORT_PADDING * 2;

    if (_debugLog) console.log('[scrollToLine] targetLine:', targetLine, 'blockIdx:', blockIdx, 'lineMap[blockIdx]:', lineMap[blockIdx], 'proportion:', proportion.toFixed(2));
    window.scrollTo({ top: scrollTarget });
}

/** Detect the source line number (1-indexed) at the top of the viewport, used to position when switching to the text editor */
function getFirstVisibleSourceLine(view: EditorView, lineMap: number[]): number {
    if (!lineMap.length) { return 1; }
    const topbarH = document.querySelector(".milkdown-top-bar")?.getBoundingClientRect().height ?? DEFAULT_TOPBAR_HEIGHT;
    const children = view.dom.children;
    for (let i = 0; i < children.length && i < lineMap.length; i++) {
        const rect = (children[i] as HTMLElement).getBoundingClientRect();
        if (rect.bottom > topbarH + VIEWPORT_PADDING) {
            const result = lineMap[i] ?? 1;
            if (_debugLog) console.log('[getFirstVisible] result:', result, 'blockIdx:', i, 'rect.bottom:', rect.bottom.toFixed(0));
            return result;
        }
    }
    // All blocks are above the viewport (theoretically impossible) → return the last block
    const fallback = lineMap[Math.min(lineMap.length - 1, children.length - 1)] ?? 1;
    if (_debugLog) console.log('[getFirstVisible] fallback result:', fallback, 'lineMap.length:', lineMap.length);
    return fallback;
}

// ── Image upload: pending promise map ────────────────────
type UploadCallbacks = {
    resolve: (url: string) => void;
    reject: (e: Error) => void;
};
const _pendingUploads = new Map<string, UploadCallbacks>();

// ── Get project image list: pending promise map ────────────
type GetImagesCallbacks = {
    resolve: (
        images: Array<{
            relPath: string;
            webviewUri: string;
            name: string;
        }> | null,
    ) => void;
    reject: (e: Error) => void;
};
const _pendingGetImages = new Map<string, GetImagesCallbacks>();

// ── Image rename: pending promise map ──────────────────
type RenameCallbacks = { resolve: () => void; reject: (e: Error) => void };
const _pendingRenames = new Map<string, RenameCallbacks>();

async function handleRenameImage(
    webviewUri: string,
    newBasename: string,
): Promise<void> {
    const id = `rename_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeoutId = setTimeout(() => {
            if (!settled) {
                settled = true;
                _pendingRenames.delete(id);
                reject(new Error("Rename timed out"));
            }
        }, 15000);
        _pendingRenames.set(id, {
            resolve: () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve();
                }
            },
            reject: (e) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    reject(e);
                }
            },
        });
        notifyRenameImage(id, webviewUri, newBasename);
    });
}

async function handleGetProjectImages(
    _unusedId: string,
): Promise<Array<{
    relPath: string;
    webviewUri: string;
    name: string;
}> | null> {
    const id = `gimgs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeoutId = setTimeout(() => {
            if (!settled) {
                settled = true;
                _pendingGetImages.delete(id);
                resolve(null);
            }
        }, 10000);
        _pendingGetImages.set(id, {
            resolve: (r) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve(r);
                }
            },
            reject: (e) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    reject(e);
                }
            },
        });
        notifyGetProjectImages(id);
    });
}

async function handleImageFile(file: File, altText: string): Promise<string> {
    const id = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    return new Promise<string>((resolve, reject) => {
        _pendingUploads.set(id, { resolve, reject });
        const timeoutId = setTimeout(() => {
            if (_pendingUploads.has(id)) {
                _pendingUploads.delete(id);
                reject(new Error("Upload timed out"));
            }
        }, 30000);
        // Read the file as a Uint8Array and send it to the extension
        const reader = new FileReader();
        reader.onload = () => {
            const data = new Uint8Array(reader.result as ArrayBuffer);
            notifyUploadImage(id, data, file.type, altText);
        };
        reader.onerror = () => {
            clearTimeout(timeoutId);
            _pendingUploads.delete(id);
            reject(new Error("Failed to read file"));
        };
        reader.readAsArrayBuffer(file);
    });
}

function insertImageNode(src: string, alt: string): void {
    const editor = currentEditor;
    if (!editor) {
        return;
    }
    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const imageType = state.schema.nodes["image"];
        if (!imageType) {
            return;
        }
        const node = imageType.create({ src, alt, title: "" });
        view.dispatch(state.tr.replaceSelectionWith(node));
        view.focus();
    });
}

// Initialize the TOC panel
const toc = initToc(() => getEditorView());
document.body.appendChild(toc.panel);

// Initialize the find bar
const findBar = initFindBar(() => document.getElementById("editor"));

/** Parse a YAML frontmatter string into a key-value array */
function parseFrontmatter(raw: string): { key: string; value: string }[] {
    return raw
        .split('\n')
        .filter(line => !line.match(/^---/) && line.includes(':'))
        .map(line => {
            const colonIdx = line.indexOf(':');
            return {
                key: line.slice(0, colonIdx).trim(),
                value: line.slice(colonIdx + 1).trim(),
            };
        })
        .filter(({ key }) => key.length > 0);
}

/** Render the frontmatter table panel before #editor; remove the panel when there is no frontmatter */
function renderFrontmatterPanel(frontmatter: string | undefined): void {
    const existing = document.getElementById('frontmatter-panel');
    const editorEl = document.getElementById('editor');
    if (!frontmatter) {
        existing?.remove();
        if (editorEl) { editorEl.style.paddingTop = ''; }
        return;
    }
    const entries = parseFrontmatter(frontmatter);
    if (entries.length === 0) {
        existing?.remove();
        if (editorEl) { editorEl.style.paddingTop = ''; }
        return;
    }
    const panel = existing ?? document.createElement('div');
    panel.id = 'frontmatter-panel';
    panel.className = 'frontmatter-panel';
    panel.innerHTML = `<table class="frontmatter-table"><tbody>${
        entries.map(({ key, value }) =>
            `<tr><td class="fm-key">${escapeHtml(key)}</td><td class="fm-val">${escapeHtml(value)}</td></tr>`
        ).join('')
    }</tbody></table>`;
    const editor = document.getElementById('editor');
    if (!existing) {
        editor?.parentNode?.insertBefore(panel, editor);
    }
    // When the frontmatter panel is present, the editor's top padding is handled by the panel; keep only a small gap
    if (editor) { editor.style.paddingTop = '16px'; }
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Word-style word count: each CJK character counts as 1, each non-CJK continuous string counts as 1, spaces don't count */
function countWords(text: string): number {
    let count = 0;
    let inNonCjk = false;
    // \p{sc=Han} matches all Han script characters (CJK Unified Ideographs + Extensions + Compatibility)
    // using Unicode property escapes — the standard, modern way to match CJK
    const cjkRe = /\p{sc=Han}/u;
    for (const ch of text) {
        if (/\s/.test(ch)) {
            inNonCjk = false;
        } else if (cjkRe.test(ch)) {
            inNonCjk = false;
            count++;
        } else {
            if (!inNonCjk) {
                inNonCjk = true;
                count++;
            }
        }
    }
    return count;
}

/** Compute the word count and notify the extension to update the status bar */
function updateWordCount(): void {
    const view = getEditorView();
    if (!view) return;
    const text = view.state.doc.textBetween(0, view.state.doc.content.size, "\n");
    notifyWordCount(
        text.split("\n").length,
        countWords(text),
        text.replace(/\s/g, "").length,
        text.length,
    );
}

async function initEditor(
    container: HTMLElement,
    markdown: string,
): Promise<void> {
    // Destroy the old editor (used on revert)
    if (currentEditor) {
        currentEditor.destroy();
        currentEditor = null;
        container.innerHTML = "";
    }

    currentEditor = await createEditor(
        container,
        markdown,
        (updated) => {
            notifyUpdate(updated);
            toc.refresh(); // Refresh the TOC on content change (no-op when the panel is collapsed)
            updateWordCount(); // Update the word count
        },
        handleRenameImage,
        () => toc.toggle(),
    );

    const syncTopBarHeight = () => {
        const topBar = document.querySelector(".milkdown-top-bar") as HTMLElement | null;
        if (!topBar) return;
        const h = Math.round(topBar.getBoundingClientRect().height);
        if (h > 0) {
            document.documentElement.style.setProperty("--epytor-topbar-height", `${h}px`);
        }
    };
    syncTopBarHeight();

    const topBarEl = document.querySelector(".milkdown-top-bar") as HTMLElement | null;
    if (topBarEl && typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => {
            syncTopBarHeight();
            toc.updatePosition();
        });
        ro.observe(topBarEl);
    }

    toc.updatePosition(); // Toolbar is ready; update the TOC's sticky position
    toc.refresh(); // Refresh once after the editor is initialized
    toc.show();    // Toolbar is ready; show the TOC panel
    updateWordCount(); // Count once after the editor is initialized
}

// Link hover popup (listening on the #editor container)
const editorContainer = document.getElementById("editor");
if (editorContainer) {
	    // Prevent the link's default navigation + Cmd/Ctrl+Click to open + anchor jump
	    // Prevent the link's default navigation + Ctrl/Cmd+Click to open + anchor jump
	    editorContainer.addEventListener("click", (e) => {
	        const anchor = (e.target as Element).closest("a");
	        if (!anchor) return;
	        const href = anchor.getAttribute("href") ?? "";
	        e.preventDefault();
	        e.stopImmediatePropagation();
	        if (href.startsWith("#")) {
	            const el = document.getElementById(href.slice(1));
	            if (el) {
	                const tb = document.querySelector(".milkdown-top-bar") as HTMLElement | null;
	                const th = tb?.getBoundingClientRect().height ?? DEFAULT_TOPBAR_HEIGHT;
	                window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - th - VIEWPORT_PADDING, behavior: "smooth" });
	            }
	            return;
	        }
	        if (e.ctrlKey || e.metaKey) {
	            const clean = href.split("#")[0];
	            if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(clean)) notifyOpenUrl(clean);
	            else notifyOpenFile(clean);
	        }
	    }, true);
		    // Close the link tooltip on scroll: release the hover lock first, then hide
	    window.addEventListener("scroll", () => {
	        document.querySelectorAll(
	            ".milkdown-link-preview, .milkdown-link-edit"
	        ).forEach(el => {
	            el.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
	            requestAnimationFrame(() => {
	                const htmlEl = el as HTMLElement;
	                htmlEl.dataset.show = "false";
	            });
	        });
	    }, true);
	    // Toolbar image insert → pop up the picker (upload + project image library + URL)
    document.addEventListener('epytor:insertImage', () => {
        showImagePicker(
            (file) => {
                handleImageFile(file, '').then(url => insertImageNode(url, '')).catch(() => {});
            },
            (relPath) => {
                insertImageNode(relPath, '');
            },
            (url) => {
                insertImageNode(url, '');
            },
            () => {
                const id = `gimgs_${Date.now().toString(36)}`;
                return new Promise<any>((resolve) => {
                    _pendingGetImages.set(id, { resolve, reject: () => {} });
                    notifyGetProjectImages(id);
                });
            },
        );
    });
    // Keep a fast-upload file input (reused by drag-and-drop and paste)
    const imgFileInput = document.createElement('input');
    imgFileInput.type = 'file'; imgFileInput.accept = 'image/*';
    imgFileInput.style.display = 'none';
    document.body.appendChild(imgFileInput);
    document.addEventListener('epytor:openSettings', () => notifyOpenSettings());
    setupPathLink(editorContainer);
    initHeadingIds(editorContainer);
    initPathComplete(() => getEditorView());
    enhanceCodeBlocks(editorContainer);
    setupTopBarTooltips(editorContainer);
    setupTopBarBrand(editorContainer);

    // Image lightbox: double-click / Ctrl+Click an image to zoom in
    editorContainer.addEventListener("mousedown", (e) => {
        const img = (e.target as Element).closest<HTMLImageElement>(
            ".image-wrapper img",
        );
        if (!img || !img.src) return;
        if (e.detail === 2 || (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey) {
            e.preventDefault();
            e.stopPropagation();
            showGlobalLightbox(img.src, img.alt);
        }
    });

    // Click the empty area below the last line of content in #editor → move the cursor to the end of the document and focus
    editorContainer.addEventListener("mousedown", (e) => {
        const view = getEditorView();
        if (!view) { return; }
        // Do not interfere when clicking inside the ProseMirror content area; let the editor handle it
        if (view.dom.contains(e.target as Node)) { return; }
        // Only respond to clicks below the last content block (exclude left/right/top padding)
        const lastChild = view.dom.lastElementChild;
        if (!lastChild) { return; }
        const lastRect = lastChild.getBoundingClientRect();
        if (e.clientY <= lastRect.bottom) { return; }
        e.preventDefault();
        const { state } = view;
        const sel = TextSelection.atEnd(state.doc);
        view.dispatch(state.tr.setSelection(sel));
        view.focus();
    });

    // Drag and drop image files into the editor
    editorContainer.addEventListener("dragover", (e) => {
        const items = e.dataTransfer?.items;
        if (
            items &&
            Array.from(items).some(
                (i) => i.kind === "file" && i.type.startsWith("image/"),
            )
        ) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    editorContainer.addEventListener("drop", (e) => {
        const files = e.dataTransfer?.files;
        if (!files?.length) {
            return;
        }
        const imageFile = Array.from(files).find((f) =>
            f.type.startsWith("image/"),
        );
        if (!imageFile) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleImageFile(imageFile, "")
            .then((url) => {
                insertImageNode(url, "");
            })
            .catch((err: Error) =>
                console.error("[ImageUpload] drop failed:", err),
            );
    }, true);
}

// Paste image (capture phase: intercept image files before ProseMirror internal paste handler)
document.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) {
        return;
    }
    const imageItem = Array.from(items).find((i) =>
        i.type.startsWith("image/"),
    );
    if (!imageItem) {
        return;
    }
    const file = imageItem.getAsFile();
    if (!file) {
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    handleImageFile(file, "")
        .then((url) => {
            insertImageNode(url, "");
        })
        .catch((err: Error) =>
            console.error("[ImageUpload] paste failed:", err),
        );
}, true);


// ── Code block copy + fullscreen ───────────────────────────────────────────────────────

function enhanceCodeBlocks(container: HTMLElement): void {
    // ── Copy button: pop up a ✔ hint after clicking ────────────────────────────────────
    container.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest('.copy-button') as HTMLElement | null;
        if (!btn) return;
        setTimeout(() => {
            const tip = applyTooltip(btn, '✔ ' + t('Copied!'));
            tip.show();
            setTimeout(() => tip.setText(t('Copy Code')), 1500);
        }, 100);
    });

    // ── Fullscreen button (pure CSS fullscreen solution, does not touch or detach the CodeMirror DOM tree)─────────────
    const addFullscreenBtn = (block: Element): void => {
        const copyBtn = block.querySelector('.copy-button') as HTMLElement | null;
        if (copyBtn && !copyBtn.dataset.tip) { copyBtn.dataset.tip = '1'; applyTooltip(copyBtn, t('Copy Code')); }
        const previewBtn = block.querySelector('.preview-toggle-button') as HTMLElement | null;
        if (previewBtn && !previewBtn.dataset.tip) { previewBtn.dataset.tip = '1'; applyTooltip(previewBtn, t('Toggle preview')); }

        if (block.querySelector('.epytor-fullscreen-btn')) return;
        const btnGroup = block.querySelector('.tools-button-group');
        if (!btnGroup) return;

        const fsBtn = document.createElement('button');
        fsBtn.className = 'epytor-fullscreen-btn';
        fsBtn.innerHTML = IconMaximize2;
        const tip = applyTooltip(fsBtn, t('View Fullscreen'));

        const toggleFullscreen = () => {
            const isFs = block.classList.toggle('epytor-code-block-fullscreen');
            if (isFs) {
                fsBtn.innerHTML = IconMinimize2;
                tip.setText(t('Exit Fullscreen'));
                document.body.classList.add('epytor-has-fullscreen-block');
                const onKey = (ke: KeyboardEvent) => {
                    if (ke.key === 'Escape') {
                        ke.preventDefault();
                        toggleFullscreen();
                    }
                };
                (fsBtn as any)._onFsKey = onKey;
                document.addEventListener('keydown', onKey);
            } else {
                fsBtn.innerHTML = IconMaximize2;
                tip.setText(t('View Fullscreen'));
                document.body.classList.remove('epytor-has-fullscreen-block');
                if ((fsBtn as any)._onFsKey) {
                    document.removeEventListener('keydown', (fsBtn as any)._onFsKey);
                    (fsBtn as any)._onFsKey = null;
                }
            }
        };

        fsBtn.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            toggleFullscreen();
        });
        btnGroup.appendChild(fsBtn);
    };

    // Add the fullscreen button to both initial and later code blocks
    const scanBlocks = () => container.querySelectorAll('.milkdown-code-block').forEach(addFullscreenBtn);
    requestAnimationFrame(scanBlocks);
    new MutationObserver(() => requestAnimationFrame(scanBlocks))
        .observe(container, { childList: true, subtree: true });

    // Keyboard navigation for the language search box
    container.addEventListener('keydown', (e) => {
        const input = e.target as HTMLElement;
        if (!input.closest('.search-box')) return;
        const list = input.closest('.list-wrapper')?.querySelector('.language-list');
        if (!list) return;
        const items = list.querySelectorAll<HTMLElement>('.language-list-item');
        if (items.length === 0) return;
        const focused = list.querySelector<HTMLElement>('.language-list-item.focused');
        let idx = -1;
        if (focused) items.forEach((el, i) => { if (el === focused) idx = i; });
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = Math.min(idx + 1, items.length - 1);
            items.forEach(el => el.classList.remove('focused'));
            items[next].classList.add('focused');
            items[next].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = Math.max(idx - 1, 0);
            items.forEach(el => el.classList.remove('focused'));
            items[prev].classList.add('focused');
            items[prev].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (focused) focused.click();
        }
    });
}

/** Add custom tooltips to the Crepe top-bar buttons (i18n translations, no shortcut hints) */
function setupTopBarTooltips(container: HTMLElement): void {
    const TOOLTIP_MAP: Record<string, string> = {
        'toc': t('Table of Contents'),
        'undo': t('Undo'),
        'redo': t('Redo'),
        'bold': t('Bold'),
        'italic': t('Italic'),
        'strikethrough': t('Strikethrough'),
        'code': t('Inline Code'),
        'clear-format': t('Clear Formatting'),
        'highlight-color': t('Highlight'),
        'bullet': t('Bullet list'),
        'ordered': t('Numbered list'),
        'task': t('Task list'),
        'link': t('Link'),
        'image': t('Image'),
        'table': t('Table'),
        'code-block': t('Code block'),
        'math': t('Math formula'),
        'quote': t('Quote'),
        'hr': t('Divider'),
        'settings': t('Settings'),
    };

    const applyAll = () => {
        const topBar = container.querySelector('.milkdown-top-bar');
        if (!topBar) return;
        const items = topBar.querySelectorAll<HTMLElement>('.top-bar-item');
        items.forEach((item) => {
            if (item.dataset.tip) return;
            const key = item.getAttribute('data-key') || item.getAttribute('data-item') || '';
            const text = (key && TOOLTIP_MAP[key]) || item.getAttribute('title') || '';
            if (text) {
                item.dataset.tip = '1';
                applyTooltip(item, text, { placement: 'below' });
            }
        });
    };

    requestAnimationFrame(applyAll);
    new MutationObserver(() => requestAnimationFrame(applyAll))
        .observe(container, { childList: true, subtree: true });
}

/** Inject the Lona 🩷 brand badge as a real flex child of the top-bar (replacing CSS ::after) */
function setupTopBarBrand(container: HTMLElement): void {
    const inject = () => {
        const topBar = container.querySelector('.milkdown-top-bar');
        if (!topBar || topBar.querySelector('.epytor-brand')) return;
        const brand = document.createElement('span');
        brand.className = 'epytor-brand';
        brand.textContent = 'Lona 🩷';
        topBar.insertBefore(brand, topBar.firstChild);
    };
    requestAnimationFrame(inject);
    new MutationObserver(() => requestAnimationFrame(inject))
        .observe(container, { childList: true, subtree: true });
}

registerSelectionChangeHandler((_view) => {
    // Selection-change callback kept for future extension
});

// Cmd/Ctrl+F: open the find bar (prefilled with the current selection text)
window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.code === "KeyF" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const view = getEditorView();
        let initialQuery: string | undefined;
        if (view) {
            const { selection, doc } = view.state;
            if (!selection.empty) {
                const text = doc.textBetween(selection.from, selection.to);
                if (text.trim()) { initialQuery = text; }
            }
        }
        findBar.open(initialQuery);
    }
});

// Cmd/Ctrl+Shift+M: switch to the text editor (carries the current viewport top line for the text editor to position on)
window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyM") {
        e.preventDefault();
        const view = getEditorView();
        const line = view ? getFirstVisibleSourceLine(view, currentLineMap) : undefined;
        notifySwitchToTextEditor(line);
    }
});

// Globally intercept Cmd/Ctrl+Z (Undo) and Cmd/Ctrl+Shift+Z / Cmd/Ctrl+Y (Redo) to guarantee reliable response
window.addEventListener(
    "keydown",
    (e) => {
        const target = e.target as HTMLElement;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
            return;
        }

        if ((e.metaKey || e.ctrlKey) && !e.altKey) {
            if (e.code === "KeyZ" && !e.shiftKey) {
                const view = getEditorView();
                if (view) {
                    e.preventDefault();
                    e.stopPropagation();
                    undo(view.state, view.dispatch, view);
                }
                return;
            }

            if ((e.code === "KeyZ" && e.shiftKey) || (e.code === "KeyY" && !e.shiftKey)) {
                const view = getEditorView();
                if (view) {
                    e.preventDefault();
                    e.stopPropagation();
                    redo(view.state, view.dispatch, view);
                }
                return;
            }
        }
    },
    true
);

// WebView is loaded; notify the extension to send the initial content
notifyReady();

// ── Scroll position persistence ────────────────────────────────────────────
// Save: write to the VSCode WebView state on scroll with debounce (recoverable across sessions)
let _scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('scroll', () => {
    if (_scrollSaveTimer) clearTimeout(_scrollSaveTimer);
    _scrollSaveTimer = setTimeout(() => {
        const cur = getWebviewState() ?? {};
        setWebviewState({ ...cur, scrollY: window.scrollY });
    }, 200);
}, { passive: true });

// Restore (main path): when a tab is switched, the iframe is hidden then shown, and the browser resets scrollY
// On visibilitychange, read the saved position and restore it
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const state = getWebviewState();
    if (state?.scrollY !== undefined) {
        requestAnimationFrame(() => {
            window.scrollTo({ top: state.scrollY as number });
        });
    }
});
// ─────────────────────────────────────────────────────────────

// Listen for messages from the extension
onMessage(async (msg) => {
    const container = document.getElementById("editor");
    if (!container) {
        return;
    }

    if (msg.type === "init" || msg.type === "revert") {
        markdownSource = msg.content; // Save the original content for line number lookup
        currentLineMap = msg.lineMap ?? [];
        renderFrontmatterPanel(msg.frontmatter);
        if (msg.imageUriMap) { setImageUriMap(msg.imageUriMap); }
        await initEditor(container, msg.content);
        // Actively grab DOM focus when a new WebView opens.
        // If we don't: the old WebView (path-link-test.md) released focus via blur() after Cmd+Click,
        // but the new WebView (README.md)'s iframe may not automatically gain focus;
        // VS Code may still route Cmd+W to the old iframe, causing both .md tabs to close.
        // init is only triggered on first open (revert is a content change); this only applies to the first open.
        if (msg.type === "init") {
            window.focus();
        }
        // When global search navigates or the user switches back to preview, scroll to the specified source line
        // Milkdown rendering + browser layout takes time, so retry multiple times to make sure the DOM is ready before scrolling
        if (msg.type === "init" && msg.scrollToLine) {
            const targetLine = msg.scrollToLine;
            let scrollDone = false;
            const tryScroll = () => {
                if (scrollDone) { return; }
                const view = getEditorView();
                if (!view) { return; }
                // Check the first block's DOM height: a value of 0 means layout hasn't completed yet
                const firstChild = view.dom.children[0] as HTMLElement | undefined;
                if (!firstChild || firstChild.getBoundingClientRect().height === 0) { return; }
                scrollToSourceLine(view, currentLineMap, targetLine);
                scrollDone = true;
            };
            // First try at 300ms (Milkdown rendering takes time); if it fails, retry at 600ms / 1100ms / 2000ms
            for (const delay of [300, 600, 1100, 2000]) {
                setTimeout(tryScroll, delay);
            }
        } else if (msg.type === "init") {
            // WebView rebuild scenarios (VSCode restart restoring tabs, etc.): restore scroll position from persisted state
            const saved = getWebviewState();
            if (saved?.scrollY) {
                const targetY = saved.scrollY as number;
                let restoreDone = false;
                const tryRestore = () => {
                    if (restoreDone) return;
                    const view = getEditorView();
                    if (!view) return;
                    const firstChild = view.dom.children[0] as HTMLElement | undefined;
                    if (!firstChild || firstChild.getBoundingClientRect().height === 0) return;
                    window.scrollTo({ top: targetY });
                    restoreDone = true;
                };
                for (const delay of [300, 600, 1100, 2000]) {
                    setTimeout(tryRestore, delay);
                }
            }
        }
    } else if (msg.type === "requestSwitchToTextEditor") {
        // "Switch to text editor" request from the menu button / command palette
        // Same logic as the Cmd+Shift+M shortcut: get the current visible line first, then notify the extension
        const view = getEditorView();
        const line = view ? getFirstVisibleSourceLine(view, currentLineMap) : undefined;
        notifySwitchToTextEditor(line);
    } else if (msg.type === "scrollToLine") {
        // When the panel is already open (e.g. a global search click opened the file), scroll directly
        // If initEditor is currently rebuilding (getEditorView returns null), retry at most 8 times
        const scrollLine = msg.line;
        let scrollAttempts = 0;
        const tryScrollNow = () => {
            const view = getEditorView();
            if (view) {
                scrollToSourceLine(view, currentLineMap, scrollLine);
            } else if (scrollAttempts < 8) {
                scrollAttempts++;
                setTimeout(tryScrollNow, 250);
            }
        };
        tryScrollNow();
    } else if (msg.type === "lineMapUpdate") {
        currentLineMap = msg.lineMap;
    } else if (msg.type === "setDebugMode") {
        _debugLog = msg.enabled;
        setLogTableSel(msg.enabled);
    } else if (msg.type === "imageUploaded") {
        const cb = _pendingUploads.get(msg.id);
        if (cb) {
            _pendingUploads.delete(msg.id);
            cb.resolve(msg.url);
        }
    } else if (msg.type === "imageUploadError") {
        const cb = _pendingUploads.get(msg.id);
        if (cb) {
            _pendingUploads.delete(msg.id);
            cb.reject(new Error(msg.error));
        }
    } else if (msg.type === "projectImagesList") {
        const cb = _pendingGetImages.get(msg.id);
        if (cb) {
            _pendingGetImages.delete(msg.id);
            cb.resolve(msg.images);
        }
    } else if (msg.type === "imageRenamed") {
        const cb = _pendingRenames.get(msg.id);
        if (cb) {
            _pendingRenames.delete(msg.id);
            cb.resolve();
        }
        // Update the src of the corresponding image node in the ProseMirror document
        const editor = currentEditor;
        if (editor) {
            editor.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                const { state } = view;
                const tr = state.tr;
                let changed = false;
                state.doc.descendants((node, pos) => {
                    if (
                        node.type.name === "image" &&
                        node.attrs["src"] === msg.oldWebviewUri
                    ) {
                        tr.setNodeMarkup(pos, null, {
                            ...node.attrs,
                            src: msg.newWebviewUri,
                        });
                        changed = true;
                    }
                });
                if (changed) {
                    view.dispatch(tr);
                }
            });
        }
    } else if (msg.type === "imageRenameError") {
        const cb = _pendingRenames.get(msg.id);
        if (cb) {
            _pendingRenames.delete(msg.id);
            cb.reject(new Error(msg.error));
        }
    } else if (msg.type === "pathSuggestions") {
        dispatchPathSuggestions(msg.id, msg.items);
        dispatchImgPathSuggestions(msg.id, msg.items);
    } else if (msg.type === "imagePathResolved") {
        dispatchImagePathResolved(msg.id, msg.webviewUri);
    }
});
