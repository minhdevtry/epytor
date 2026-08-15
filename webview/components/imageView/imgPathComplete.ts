import { notifyGetPathSuggestions, notifyResolveImagePath } from "@/messaging";
import { getFileIcon } from "../pathLink/fileIcons";
import type { PathSuggestionItem } from "../../../shared/messages";
import {
    closeDropdown as closeDropdownState,
    updateActiveItem,
    type DropdownState,
} from "@/ui/dropdownComplete";

const IMG_ACTIVE_CLASS = "img-path-complete-item--active";

// ─── Constants ────────────────────────────────────────────────────
const RESOLVE_IMAGE_TIMEOUT_MS = 3000;
const PATH_SUGGESTION_TIMEOUT_MS = 5000;
const PATH_COMPLETE_RETRIGGER_DELAY_MS = 50;
const PATH_COMPLETE_DEBOUNCE_MS = 200;
const IMAGE_BLUR_CLOSE_DELAY_MS = 150;

// ─── resolveImagePath async mechanism ────────────────────────────────
const _pendingResolve = new Map<string, (uri: string) => void>();

/** Called by index.ts when an imagePathResolved message arrives */
export function dispatchImagePathResolved(id: string, webviewUri: string): void {
    const cb = _pendingResolve.get(id);
    if (cb) { _pendingResolve.delete(id); cb(webviewUri); }
}

/** Resolve a relPath to a webviewUri (async; returns the original value after a 3s timeout) */
export function resolveToWebviewUri(relPath: string): Promise<string> {
    return new Promise((resolve) => {
        const id = `rip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
        const timer = setTimeout(() => {
            _pendingResolve.delete(id);
            resolve(relPath); // Fallback on timeout
        }, RESOLVE_IMAGE_TIMEOUT_MS);
        _pendingResolve.set(id, (uri) => {
            clearTimeout(timer);
            resolve(uri);
        });
        notifyResolveImagePath(id, relPath);
    });
}

// Prefix detection that triggers path completion (kept in sync with pathComplete.ts)
const PATH_PREFIX_REGEX = /^(@\/|\.{1,2}\/|[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)/;

type SuggestCallback = (items: PathSuggestionItem[]) => void;

// Callback map: id → resolve (globally unique; each input is distinguished by id)
const _pendingImgSuggestions = new Map<string, SuggestCallback>();

/** External callers use this to dispatch pathSuggestions messages to this module */
export function dispatchImgPathSuggestions(id: string, items: PathSuggestionItem[]): void {
    const cb = _pendingImgSuggestions.get(id);
    if (cb) {
        _pendingImgSuggestions.delete(id);
        cb(items);
    }
}

/**
 * Attach image path auto-complete to an <input> element.
 * @param onEnter  Called with Enter when the dropdown closes (i.e. confirm)
 * @param onEscape Called with Escape when the dropdown closes (i.e. cancel)
 * Returns a cleanup function that removes the event listeners and closes the dropdown.
 */
export function attachImgPathComplete(
    input: HTMLInputElement,
    onEnter?: () => void,
    onEscape?: () => void,
): () => void {
    const state: DropdownState = { el: null, activeIndex: -1 };
    let lastItems: PathSuggestionItem[] = [];
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let suppressMouseover = false;
    let isDestroyed = false;
    let skipDatasetClear = false;

    function closeDropdown(): void { closeDropdownState(state); lastItems = []; }

    function applySelection(item: PathSuggestionItem): void {
        input.value = item.path;
        if (item.webviewUri) {
            input.dataset.imgWebviewUri = item.webviewUri;
        } else {
            delete input.dataset.imgWebviewUri;
        }
        skipDatasetClear = true;
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        input.focus();

        if (item.isDir) {
            closeDropdown();
            setTimeout(() => { triggerSuggest(); }, PATH_COMPLETE_RETRIGGER_DELAY_MS);
        } else {
            closeDropdown();
        }
    }

    function showDropdown(items: PathSuggestionItem[]): void {
        closeDropdown();
        const filtered = items.filter(item => item.isDir || item.webviewUri !== undefined);
        if (filtered.length === 0) { return; }
        lastItems = filtered;

        const rect = input.getBoundingClientRect();
        const ul = document.createElement("ul");
        ul.className = "img-path-complete-list";
        ul.style.top = `${rect.bottom + 2}px`;
        ul.style.left = `${rect.left}px`;
        ul.style.minWidth = `${rect.width}px`;

        filtered.forEach((item, i) => {
            const li = document.createElement("li");
            li.className = "img-path-complete-item";

            if (item.webviewUri) {
                const thumb = document.createElement("img");
                thumb.className = "img-complete-thumb";
                thumb.src = item.webviewUri;
                thumb.alt = "";
                li.appendChild(thumb);
            } else {
                const iconEl = document.createElement("span");
                iconEl.className = "img-complete-icon";
                iconEl.innerHTML = getFileIcon(item.path, item.isDir);
                li.appendChild(iconEl);
            }

            const lastSeg = item.path.replace(/\/$/, "").split("/").pop() ?? item.path;
            const label = document.createElement("span");
            label.className = "img-complete-label";
            label.textContent = lastSeg;
            li.title = item.path;
            li.appendChild(label);

            li.addEventListener("mousedown", (e) => {
                e.preventDefault();
                state.activeIndex = i;
                applySelection(item);
            });
            li.addEventListener("mousemove", () => { suppressMouseover = false; });
            li.addEventListener("mouseover", () => {
                if (suppressMouseover) { return; }
                state.activeIndex = i;
                updateActiveItem(state, IMG_ACTIVE_CLASS);
            });

            ul.appendChild(li);
        });

        document.body.appendChild(ul);
        state.el = ul;
        state.activeIndex = 0;
        updateActiveItem(state, IMG_ACTIVE_CLASS);
    }

    // ── Trigger completion request ───────────────────────────────────────────

    function triggerSuggest(): void {
        const query = input.value.trim();
        if (!query || !PATH_PREFIX_REGEX.test(query)) {
            closeDropdown();
            return;
        }

        const id = `ips_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        _pendingImgSuggestions.set(id, (items) => {
            if (!isDestroyed) {
                showDropdown(items);
            }
        });
        notifyGetPathSuggestions(id, query);

        // Timeout cleanup
        setTimeout(() => {
            _pendingImgSuggestions.delete(id);
        }, PATH_SUGGESTION_TIMEOUT_MS);
    }

    // ── Event listeners ───────────────────────────────────────────────

    function onInput(): void {
        // Don't clear the dataset on the first onInput after an autocomplete selection (the dataset is what we use to tell manual input apart)
        if (skipDatasetClear) {
            skipDatasetClear = false;
        } else {
            delete input.dataset.imgWebviewUri;
        }
        if (debounceTimer) { clearTimeout(debounceTimer); }
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            if (!isDestroyed) { triggerSuggest(); }
        }, PATH_COMPLETE_DEBOUNCE_MS);
    }

    function onKeydown(e: KeyboardEvent): void {
        if (e.isComposing) { return; }

        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (state.el && state.activeIndex >= 0 && state.activeIndex < lastItems.length) {
                applySelection(lastItems[state.activeIndex]);
            } else {
                onEnter?.();
            }
            return;
        }

        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (state.el) {
                closeDropdown();
            } else {
                onEscape?.();
            }
            return;
        }

        if (!state.el) { return; }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            suppressMouseover = true;
            state.activeIndex = state.activeIndex >= lastItems.length - 1 ? 0 : state.activeIndex + 1;
            updateActiveItem(state, IMG_ACTIVE_CLASS);
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            suppressMouseover = true;
            state.activeIndex = state.activeIndex <= 0 ? lastItems.length - 1 : state.activeIndex - 1;
            updateActiveItem(state, IMG_ACTIVE_CLASS);
            return;
        }
        if (e.key === "Tab") {
            if (state.activeIndex >= 0 && state.activeIndex < lastItems.length) {
                e.preventDefault();
                e.stopPropagation();
                applySelection(lastItems[state.activeIndex]);
            }
            return;
        }
    }

    function onDocMousedown(e: MouseEvent): void {
        if (state.el && !state.el.contains(e.target as Node) && e.target !== input) {
            closeDropdown();
        }
    }

    function onBlur(): void {
        // Delay closing so that mousedown's applySelection runs first
        setTimeout(() => {
            if (!isDestroyed) { closeDropdown(); }
        }, IMAGE_BLUR_CLOSE_DELAY_MS);
    }

    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeydown, true);
    input.addEventListener("blur", onBlur);
    document.addEventListener("mousedown", onDocMousedown, true);

    // ── cleanup ────────────────────────────────────────────────

    return function detach(): void {
        isDestroyed = true;
        if (debounceTimer) { clearTimeout(debounceTimer); }
        closeDropdown();
        input.removeEventListener("input", onInput);
        input.removeEventListener("keydown", onKeydown, true);
        input.removeEventListener("blur", onBlur);
        document.removeEventListener("mousedown", onDocMousedown, true);
    };
}
