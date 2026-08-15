import type { Node as PMNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type {
    Decoration,
    DecorationSource,
    EditorView,
} from "@milkdown/kit/prose/view";
import {
    IconZoomIn,
    IconPencil,
    IconTrash2,
    IconCheck,
    IconX,
    IconImageOff,
} from "@/ui/icons";
import { t } from "@/i18n";
import { createButton, createSeparator, setupInputKeyboard } from "@/ui/dom";
import { attachImgPathComplete, resolveToWebviewUri } from './imgPathComplete';
import './imageView.css';

// ─── Constants ────────────────────────────────────────────────────
const MAX_IMAGE_LOAD_RETRIES = 5;
const IMAGE_RETRY_BASE_DELAY_MS = 200;
const IMAGE_RETRY_MAX_DELAY_MS = 2000;
const MIN_IMAGE_RESIZE_HEIGHT = 40;
const MAX_IMAGE_RESIZE_RATIO = 0.8;

// ─── webviewUri ↔ relPath two-way map (written by index.ts when receiving init/revert messages)─────
const _uriToRel = new Map<string, string>(); // webviewUri → relPath
const _relToUri = new Map<string, string>(); // relPath    → webviewUri

/** Called externally (by index.ts) after receiving imageUriMap in init/revert */
export function setImageUriMap(map: Record<string, string>): void {
    _uriToRel.clear();
    _relToUri.clear();
    for (const [uri, rel] of Object.entries(map)) {
        _uriToRel.set(uri, rel);
        _relToUri.set(rel, uri);
    }
}

/** Convert a webviewUri to a displayable relPath (returns the original value if not found) */
function toDisplayPath(src: string): string {
    return _uriToRel.get(src) ?? src;
}

/** Convert a relPath to a webviewUri that can be rendered directly in the NodeView (returns the original value if not found) */
function toWebviewUri(src: string): string {
    return _relToUri.get(src) ?? src;
}

type ViewMutationRecord = MutationRecord | { type: "selection"; target: Node };

// ─── Lightbox ──────────────────────────────────────────────
let activeLightbox: HTMLElement | null = null;

export function showGlobalLightbox(src: string, alt: string): void {
    if (activeLightbox) {
        return;
    }

    const lb = document.createElement("div");
    lb.className = "img-editor-lightbox";

    const img = document.createElement("img");
    img.className = "img-editor-lightbox-img";
    img.src = src;
    img.alt = alt;

    const closeBtn = document.createElement("button");
    closeBtn.className = "img-editor-lightbox-close";
    closeBtn.innerHTML = IconX;
    closeBtn.title = t("Close");

    lb.appendChild(img);
    lb.appendChild(closeBtn);
    document.body.appendChild(lb);
    activeLightbox = lb;

    function close(): void {
        if (activeLightbox && document.body.contains(activeLightbox)) {
            document.body.removeChild(activeLightbox);
        }
        activeLightbox = null;
        document.removeEventListener("keydown", onKeyDown);
    }

    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === "Escape") {
            e.preventDefault();
            close();
        }
    }

    lb.addEventListener("mousedown", (e) => {
        if (e.target === lb) {
            close();
        }
    });
    closeBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
    });
    document.addEventListener("keydown", onKeyDown);
}

// ─── Stop input events from bubbling to ProseMirror ────────────────────
// ProseMirror listens for copy/cut/paste/keydown etc. events on view.dom;
// clipboard operations inside an input would bubble and be intercepted (ProseMirror's copy handler calls preventDefault).
// Stop these events from bubbling on the input so the browser's native behavior triggers normally.
function isolateInput(input: HTMLInputElement): void {
    const stopOnly = (e: Event) => e.stopPropagation();
    input.addEventListener("copy", stopOnly);
    input.addEventListener("cut", stopOnly);
    input.addEventListener("paste", stopOnly);
    input.addEventListener("mousedown", stopOnly);
    input.addEventListener("click", stopOnly);
    input.addEventListener("select", stopOnly);
    // Note: do not stopPropagation keydown here —
    // VS Code WebView relies on keydown bubbling to window to trigger native clipboard operations
}

// ─── Helper: extract file name from src (without extension) ───────────────
function basenameNoExt(src: string): string {
    const name = src.split("/").pop() ?? src;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
}

// ─── Toolbar button factory ────────────────────────────────────────
function makeBtn(icon: string, label: string): HTMLButtonElement {
    return createButton({ className: "img-tb-btn", icon, tabIndex: -1, title: label, tooltipPlacement: "above" });
}

function makeSep(): HTMLElement {
    return createSeparator("img-tb-sep", "span");
}

// ─── Toolbar inline edit helper ──────────────────────────────────────
interface ToolbarInlineEditOptions {
    initialValue: string;
    placeholder: string;
    /** Confirm callback; value is the input value; the input keeps dataset and other attributes */
    onConfirm: (value: string, input: HTMLInputElement) => void;
    /** Cancel callback */
    onCancel?: () => void;
    /**
     * Optional input enhancement (e.g. autocomplete).
     * Receives the input and the confirm/cancel callbacks; returns a detach cleanup function.
     * When not provided, setupInputKeyboard is used by default to handle Enter/Escape.
     */
    setupComplete?: (
        input: HTMLInputElement,
        confirm: () => void,
        cancel: () => void,
    ) => (() => void) | void;
}

/**
 * Start an inline edit on the toolbar: hide the original content, show an input + confirm/cancel buttons.
 * After confirm/cancel, the toolbar's original appearance is restored.
 */
function startToolbarInlineEdit(
    toolbar: HTMLElement,
    options: ToolbarInlineEditOptions,
): void {
    const input = document.createElement("input");
    input.className = "img-rename-input";
    input.value = options.initialValue;
    input.placeholder = options.placeholder;
    isolateInput(input);

    function doConfirm(): void {
        const value = input.value.trim();
        options.onConfirm(value, input);
        cleanup();
    }

    function doCancel(): void {
        options.onCancel?.();
        cleanup();
    }

    const confirmBtn = createButton({
        className: "img-tb-btn",
        tabIndex: -1,
        icon: IconCheck,
        onClick: doConfirm,
    });
    confirmBtn.style.color = "var(--vscode-charts-green, #4caf50)";
    const cancelBtn = createButton({
        className: "img-tb-btn",
        tabIndex: -1,
        icon: IconX,
        onClick: doCancel,
    });

    // Hide the original toolbar content and show the edit controls
    Array.from(toolbar.children).forEach((el) => {
        (el as HTMLElement).style.display = "none";
    });
    toolbar.appendChild(input);
    toolbar.appendChild(confirmBtn);
    toolbar.appendChild(cancelBtn);

    input.focus();
    input.select();

    const detachComplete = options.setupComplete
        ? (options.setupComplete(input, doConfirm, doCancel) ?? undefined)
        : undefined;

    if (!options.setupComplete) {
        setupInputKeyboard(input, doConfirm, doCancel);
    }

    function cleanup(): void {
        detachComplete?.();
        if (toolbar.contains(input)) toolbar.removeChild(input);
        if (toolbar.contains(confirmBtn)) toolbar.removeChild(confirmBtn);
        if (toolbar.contains(cancelBtn)) toolbar.removeChild(cancelBtn);
        Array.from(toolbar.children).forEach((el) => {
            (el as HTMLElement).style.display = "";
        });
    }
}

// ─── NodeView factory ─────────────────────────────────────────
export function createImageView(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    _decorations?: readonly Decoration[],
    _innerDecorations?: DecorationSource,
    onRenameImage?: (webviewUri: string, newBasename: string) => Promise<void>,
): {
    dom: HTMLElement;
    update: (n: PMNode) => boolean;
    selectNode: () => void;
    deselectNode: () => void;
    stopEvent: (e: Event) => boolean;
    ignoreMutation: (m: ViewMutationRecord) => boolean;
    destroy: () => void;
} {
    let currentNode = node;

    // ── Outer wrapper ──────────────────────────────────────────
    const wrapper = document.createElement("div");
    wrapper.className = "image-wrapper";

    // ── ratio encode/decode (stored at the end of title, no schema change)──────
    const RATIO_RE = /\s*ratio:([\d.]+)\s*$/;
    function parseRatio(title: string): { clean: string; ratio: number } {
        const m = title.match(RATIO_RE);
        return m ? { clean: title.replace(RATIO_RE, "").trim(), ratio: parseFloat(m[1]) || 1 } : { clean: title, ratio: 1 };
    }
    function encodeRatio(title: string, ratio: number): string {
        if (ratio === 1) return title;
        const { clean } = parseRatio(title);
        const r = `ratio:${ratio.toFixed(2)}`;
        return clean ? `${clean} ${r}` : r;
    }

    let currentRatio = parseRatio((node.attrs["title"] as string) ?? "").ratio;

    let rawSrc = (node.attrs["src"] as string) ?? "";

    // ── Image ──────────────────────────────────────────────────
    const img = document.createElement("img");
    img.className = "image-node";
    img.alt = (node.attrs["alt"] as string) ?? "";
    img.draggable = false;
    let imgNaturalH = 0;

    function resolveAndSetSrc(src: string): void {
        if (!src) {
            img.src = "";
            return;
        }
        if (/^(https?:|data:|blob:|vscode-webview-|vscode-resource:)/i.test(src)) {
            img.src = src;
            return;
        }
        const cached = _relToUri.get(src);
        if (cached) {
            img.src = cached;
            return;
        }
        resolveToWebviewUri(src).then((resolved) => {
            if (resolved && resolved !== src) {
                _relToUri.set(src, resolved);
                _uriToRel.set(resolved, src);
                img.src = resolved;
            } else {
                img.src = src;
            }
        }).catch(() => {
            img.src = src;
        });
    }

    resolveAndSetSrc(rawSrc);

    function applyRatio(): void {
        if (imgNaturalH <= 0) imgNaturalH = img.naturalHeight || 0;
        if (imgNaturalH <= 0) return;
        if (currentRatio === 1) { img.style.height = ""; return; }
        img.style.height = `${Math.round(imgNaturalH * currentRatio)}px`;
        img.style.width = "";
    }

    // ── Loading placeholder ──────────────────────────────────────────
    let imgErrored = false;
    let imgLoaded = false;
    const loadingPlaceholder = document.createElement("div");
    loadingPlaceholder.className = "img-loading-placeholder";
    loadingPlaceholder.innerHTML = '<span class="img-loading-spinner"></span><span>Loading...</span>';

    // ── Image load failure placeholder ────────────────────────────────────
    const errorPlaceholder = document.createElement("div");
    errorPlaceholder.className = "img-error-placeholder";
    errorPlaceholder.style.display = "none";
    errorPlaceholder.title = t("Click to edit image path");
    errorPlaceholder.style.cursor = "pointer";
    errorPlaceholder.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        startSrcEdit();
    });

    let retryCount = 0;
    img.addEventListener("error", () => {
        if (retryCount < MAX_IMAGE_LOAD_RETRIES) {
            retryCount++;
            const delay = Math.min(IMAGE_RETRY_BASE_DELAY_MS * retryCount, IMAGE_RETRY_MAX_DELAY_MS);
            setTimeout(() => {
                const src = img.src;
                img.src = "";
                img.src = src.replace(/([?&])_r=\d+/, "") + (src.includes("?") ? "&" : "?") + "_r=" + Date.now();
            }, delay);
            return;
        }
        imgErrored = true;
        img.style.display = "none";
        loadingPlaceholder.style.display = "none";
        errorPlaceholder.innerHTML = `${IconImageOff}<span>${t("Image not found")} (${toDisplayPath(rawSrc)})</span>`;
        errorPlaceholder.style.display = "flex";
    });

    img.addEventListener("load", () => {
        imgLoaded = true;
        imgNaturalH = img.naturalHeight;
        loadingPlaceholder.style.display = "none";
        if (imgErrored) {
            imgErrored = false;
            img.style.display = "";
            errorPlaceholder.style.display = "none";
        }
        applyRatio();
    });

    // Initially show the loading state (the image will naturally switch to load/error later)
    loadingPlaceholder.style.display = "flex";

    // ── Caption display (description text below the image)─────────────────────────
    const captionEl = document.createElement("div");
    captionEl.className = "image-caption";
    captionEl.textContent = parseRatio((node.attrs["title"] as string) ?? "").clean;
    captionEl.addEventListener("mousedown", (e) => {
        // Double-click the caption to enter edit mode
        if (e.detail === 2) { e.preventDefault(); startCaptionEdit(); }
    });

    // ── Resize handle ─────────────────────────────────────────────
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "img-resize-handle";
    let resizeStartY = 0, resizeStartH = 0;

    resizeHandle.addEventListener("pointerdown", (e) => {
        e.preventDefault(); e.stopPropagation();
        resizeStartY = e.clientY;
        resizeStartH = img.getBoundingClientRect().height || imgNaturalH;
        document.body.style.cursor = "nwse-resize";
        window.addEventListener("pointermove", onResizeMove);
        window.addEventListener("pointerup", onResizeUp);
    });
    function onResizeMove(e: PointerEvent) {
        const h = Math.max(MIN_IMAGE_RESIZE_HEIGHT, Math.min(window.innerHeight * MAX_IMAGE_RESIZE_RATIO, resizeStartH + (e.clientY - resizeStartY)));
        img.style.height = `${h}px`;
    }
    function onResizeUp() {
        window.removeEventListener("pointermove", onResizeMove);
        window.removeEventListener("pointerup", onResizeUp);
        document.body.style.cursor = "";
        const h = parseFloat(img.style.height) || imgNaturalH;
        if (imgNaturalH <= 0 || h <= 0) return;
        currentRatio = parseFloat((h / imgNaturalH).toFixed(2));
        const pos = getPos();
        if (pos === undefined) return;
        const newTitle = encodeRatio((currentNode.attrs["title"] as string) ?? "", currentRatio);
        view.dispatch(view.state.tr.setNodeMarkup(pos, null, {
            ...currentNode.attrs,
            title: newTitle,
        }));
    }

    // ── Toolbar ────────────────────────────────────────────────
    const toolbar = document.createElement("div");
    toolbar.className = "image-toolbar";
    toolbar.contentEditable = "false";

    // Zoom-in button
    const zoomBtn = makeBtn(IconZoomIn, t("View Full Size"));
    zoomBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showGlobalLightbox(img.src, img.alt);
    });

    // Caption edit (stored in title, coexists with ratio)
    const captionBtn = createButton({
        className: "img-tb-btn",
        tabIndex: -1,
        label: "CAP/ALT",
        title: t("Edit Caption"),
        tooltipPlacement: "above",
        onClick: () => startCaptionEdit(),
    });
    captionBtn.style.fontWeight = "600";

    // Pencil icon: always shown, click to edit the image path (src attribute)
    const renameBtn = makeBtn(IconPencil, t("Edit Image Path"));
    renameBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        startSrcEdit();
    });

    // Delete button
    const deleteBtn = makeBtn(IconTrash2, t("Delete"));
    deleteBtn.style.color = "var(--vscode-errorForeground, #f44)";
    deleteBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = getPos();
        if (pos === undefined) {
            return;
        }
        view.dispatch(view.state.tr.delete(pos, pos + currentNode.nodeSize));
        view.focus();
    });

    // ── Info area: span (read-only, remote images) + input (editable file name, local images)──
    const infoSpan = document.createElement("span");
    infoSpan.className = "img-tb-info";

    const infoInput = document.createElement("input");
    infoInput.type = "text";
    infoInput.className = "img-tb-info img-tb-info--input";
    isolateInput(infoInput);

    let currentInfoEl: HTMLElement = infoSpan;

    function updateInfo(src: string, _alt: string): void {
        const name = src.split("/").pop() ?? src;
        const caption = parseRatio((currentNode.attrs["title"] as string) ?? "").clean;
        const display = caption ? `${name} · ${caption}` : name;
        infoSpan.textContent = display;
        infoSpan.title = display;
        if (document.activeElement !== infoInput) {
            infoInput.value = basenameNoExt(src);
            infoInput.title = name;
        }
    }

    // Local image detection: vscode-webview-resource: (old) or vscode-cdn.net / vscode-resource (new)
    function isLocalImage(src: string): boolean {
        return /vscode-resource|vscode-cdn\.net/.test(src);
    }

    function updateInfoElement(src: string): void {
        const shouldUseInput = isLocalImage(src) && !!onRenameImage;
        const newEl = shouldUseInput ? infoInput : infoSpan;
        if (currentInfoEl !== newEl && currentInfoEl.parentElement) {
            currentInfoEl.parentElement.replaceChild(newEl, currentInfoEl);
            currentInfoEl = newEl;
        }
    }

    // infoInput keyboard events (local image file name rename)
    infoInput.addEventListener("keydown", (e) => {
        if (e.isComposing) {
            return;
        }
        if (e.key === "Enter") {
            e.stopPropagation();
            e.preventDefault();
            const newBasename = infoInput.value.trim();
            const orig = basenameNoExt(rawSrc);
            if (newBasename && newBasename !== orig && onRenameImage) {
                onRenameImage(rawSrc, newBasename).catch(() => {});
            } else {
                infoInput.value = orig;
            }
            infoInput.blur();
            view.focus();
        } else if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            infoInput.value = basenameNoExt(rawSrc);
            infoInput.blur();
            view.focus();
        }
    });

    infoInput.addEventListener("blur", () => {
        // If unconfirmed on blur, restore the original value
        infoInput.value = basenameNoExt(rawSrc);
    });

    infoInput.addEventListener("focus", () => {
        infoInput.select();
    });

    // ── Assemble the toolbar (fixed layout, renameBtn is always shown)────────────────
    toolbar.appendChild(currentInfoEl); // Initially infoSpan
    toolbar.appendChild(makeSep());
    toolbar.appendChild(zoomBtn);
    toolbar.appendChild(makeSep());
    toolbar.appendChild(captionBtn);
    toolbar.appendChild(makeSep());
    toolbar.appendChild(renameBtn);     // Always shown
    toolbar.appendChild(makeSep());
    toolbar.appendChild(deleteBtn);

    wrapper.appendChild(img);
    wrapper.appendChild(captionEl);
    wrapper.appendChild(resizeHandle);
    wrapper.appendChild(loadingPlaceholder);
    wrapper.appendChild(errorPlaceholder);
    wrapper.appendChild(toolbar);

    // ── Initialize the info area ──────────────────────────────────────────
    rawSrc = (node.attrs["src"] as string) ?? "";
    updateInfo(rawSrc, img.alt);
    updateInfoElement(rawSrc); // May replace infoSpan with infoInput

    // ── Caption inline edit (stored in title, coexists with ratio)──────────
    let isEditingCaption = false;

    function startCaptionEdit(): void {
        if (isEditingCaption) return;
        isEditingCaption = true;

        const caption = parseRatio((currentNode.attrs["title"] as string) ?? "").clean;
        startToolbarInlineEdit(toolbar, {
            initialValue: caption,
            placeholder: t("Caption"),
            onConfirm: (newCaption) => {
                isEditingCaption = false;
                const pos = getPos();
                if (pos === undefined) return;
                const newTitle = encodeRatio(newCaption, currentRatio);
                view.dispatch(view.state.tr.setNodeMarkup(pos, null, {
                    ...currentNode.attrs,
                    title: newCaption !== caption ? newTitle : currentNode.attrs.title,
                    alt: newCaption || "",
                }));
                img.alt = newCaption || "";
                captionEl.textContent = newCaption;
                view.focus();
            },
            onCancel: () => {
                isEditingCaption = false;
                view.focus();
            },
        });
    }

    // ── Edit image path (src attribute)────────────────────────────────
    let isEditingSrc = false;

    function startSrcEdit(): void {
        if (isEditingSrc) return;
        isEditingSrc = true;

        startToolbarInlineEdit(toolbar, {
            initialValue: toDisplayPath(rawSrc),
            placeholder: t("Image path or URL"),
            setupComplete: attachImgPathComplete,
            onConfirm: (displayVal, input) => {
                isEditingSrc = false;
                // ① webviewUri stored in the dataset during completion is the most reliable
                const datasetUri = (input.dataset.imgWebviewUri ?? "").trim();
                // ② Existing map (built by init/revert)
                const mappedUri = displayVal ? toWebviewUri(displayVal) : "";

                const applyUri = (newSrc: string) => {
                    if (!newSrc || newSrc === rawSrc) { view.focus(); return; }
                    const pos = getPos();
                    if (pos === undefined) { view.focus(); return; }
                    const nodeSize = currentNode.nodeSize;
                    const tr = view.state.tr.setNodeMarkup(pos, null, { ...currentNode.attrs, src: newSrc });
                    const afterPos = pos + nodeSize;
                    if (afterPos <= tr.doc.content.size) {
                        try { tr.setSelection(TextSelection.near(tr.doc.resolve(afterPos), 1)); } catch { /* After setNodeMarkup the node position may shift; ignore cursor restore failure */ }
                    }
                    view.dispatch(tr);
                    view.focus();
                };

                if (datasetUri) {
                    applyUri(datasetUri);
                } else if (mappedUri !== displayVal) {
                    applyUri(mappedUri);
                } else if (displayVal) {
                    // Absolute URLs are used directly, no extension resolution needed
                    if (/^https?:\/\//i.test(displayVal)) {
                        applyUri(displayVal);
                    } else {
                        resolveToWebviewUri(displayVal).then(applyUri);
                    }
                }
            },
            onCancel: () => {
                isEditingSrc = false;
                view.focus();
            },
        });
    }

    // ── NodeView interface ─────────────────────────────────────────
    return {
        dom: wrapper,

        update(updatedNode: PMNode): boolean {
            if (updatedNode.type !== currentNode.type) {
                return false;
            }
            const newSrc = (updatedNode.attrs["src"] as string) ?? "";
            const newAlt = (updatedNode.attrs["alt"] as string) ?? "";
            if (rawSrc !== newSrc) {
                rawSrc = newSrc;
                imgLoaded = false;
                imgErrored = false;
                imgNaturalH = 0;
                loadingPlaceholder.style.display = "flex";
                errorPlaceholder.style.display = "none";
                resolveAndSetSrc(newSrc);
                updateInfoElement(newSrc);
            }
            const newTitle = (updatedNode.attrs["title"] as string) ?? "";
            const { ratio: parsedRatio, clean: caption } = parseRatio(newTitle);
            captionEl.textContent = caption;
            if (currentRatio !== parsedRatio) {
                currentRatio = parsedRatio;
                if (imgNaturalH > 0) applyRatio();
            }
            if (img.alt !== newAlt) {
                img.alt = newAlt;
            }
            currentNode = updatedNode;
            updateInfo(rawSrc, newAlt);
            return true;
        },

        selectNode(): void {
            wrapper.classList.add("image-wrapper--selected");
            toolbar.style.display = "flex";
            resizeHandle.classList.add("img-resize-handle--visible");
            toolbar.classList.add("image-toolbar--below");
        },

        deselectNode(): void {
            wrapper.classList.remove("image-wrapper--selected");
            toolbar.style.display = "none";
            resizeHandle.classList.remove("img-resize-handle--visible");
        },

        stopEvent(e: Event): boolean {
            // Events inside the toolbar (buttons, inputs) are kept from ProseMirror
            return toolbar.contains(e.target as Node);
        },

        ignoreMutation(_m: ViewMutationRecord): boolean {
            // No contentDOM; all DOM changes are UI-level, ProseMirror does not need to see them
            return true;
        },

        destroy(): void {
            // Clean up the lightbox (if the one triggered by this image is still showing)
            if (activeLightbox && document.body.contains(activeLightbox)) {
                const lbImg = activeLightbox.querySelector("img");
                if (lbImg && lbImg.src === img.src) {
                    document.body.removeChild(activeLightbox);
                    activeLightbox = null;
                }
            }
        },
    };
}
