import { notifyGetPathSuggestions } from "@/messaging";
import { getFileIcon } from "./fileIcons";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
    closeDropdown as closeDropdownState,
    updateActiveItem,
    type DropdownState,
} from "@/ui/dropdownComplete";

const PATH_ACTIVE_CLASS = "path-complete-item--active";

// ─── 常量 ────────────────────────────────────────────────────
const PATH_RETRIGGER_DELAY_MS = 50;
const PATH_SUGGESTION_TIMEOUT_MS = 5000;
const PATH_DEBOUNCE_MS = 200;

// 触发补全的路径前缀检测
const PATH_PREFIX_REGEX = /^(@\/|\.{1,2}\/|[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)/;

type SuggestionItem = { path: string; isDir: boolean };
type SuggestCallback = (items: SuggestionItem[]) => void;

// 路径补全回调 map：id → resolve
const _pendingSuggestions = new Map<string, SuggestCallback>();

/** 外部调用此函数分发 pathSuggestions 消息 */
export function dispatchPathSuggestions(id: string, items: SuggestionItem[]): void {
    const cb = _pendingSuggestions.get(id);
    if (cb) {
        _pendingSuggestions.delete(id);
        cb(items);
    }
}

/** 获取当前光标所在的 inline code 元素（排除 pre>code 和 a>code） */
function getActiveInlineCode(): HTMLElement | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { return null; }
    const node = sel.anchorNode;
    if (!node) { return null; }
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    if (!el) { return null; }
    const code = el.closest("code");
    if (!code) { return null; }
    if (code.closest("pre")) { return null; }
    if (code.closest("a")) { return null; }
    return code as HTMLElement;
}

/** 通过当前 ProseMirror 选区位置查找 inlineCode mark 的文本范围 */
function getCodeNodeRangeFromSelection(view: EditorView): { from: number; to: number } | null {
    const { state } = view;
    const codeMark = state.schema.marks["inlineCode"];
    if (!codeMark) { return null; }

    const { $from } = state.selection;
    const parentStart = $from.start();
    let from: number | undefined;
    let to: number | undefined;
    $from.parent.forEach((node, offset) => {
        if (node.isText && node.marks.some(m => m.type === codeMark)) {
            const s = parentStart + offset;
            const e = s + node.nodeSize;
            if ($from.pos >= s && $from.pos <= e) {
                from = s;
                to = e;
            }
        }
    });
    return from !== undefined && to !== undefined ? { from, to } : null;
}

export function initPathComplete(getEditorViewFn: () => EditorView | null): void {
    const state: DropdownState = { el: null, activeIndex: -1 };
    let lastItems: SuggestionItem[] = [];
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let savedRange: { from: number; to: number } | null = null;
    let suppressMouseover = false;

    function closeDropdown(): void { closeDropdownState(state); lastItems = []; savedRange = null; }

    function applySelection(item: SuggestionItem): void {
        const view = getEditorViewFn();
        if (!view) { closeDropdown(); return; }
        const range = savedRange ?? getCodeNodeRangeFromSelection(view);
        if (!range) { closeDropdown(); return; }
        const codeMark = view.state.schema.marks["inlineCode"];
        if (!codeMark) { return; }
        const { state: editorState } = view;
        view.dispatch(
            editorState.tr.replaceRangeWith(
                range.from,
                range.to,
                editorState.schema.text(item.path, [codeMark.create()]),
            ),
        );
        view.focus();

        if (item.isDir) {
            closeDropdown();
            setTimeout(() => {
                const newCode = getActiveInlineCode();
                if (newCode) { triggerSuggest(newCode); }
            }, PATH_RETRIGGER_DELAY_MS);
        } else {
            closeDropdown();
        }
    }

    function showDropdown(code: HTMLElement, items: SuggestionItem[]): void {
        closeDropdown();
        if (items.length === 0) { return; }

        lastItems = items;

        const view = getEditorViewFn();
        if (view) { savedRange = getCodeNodeRangeFromSelection(view); }

        const rect = code.getBoundingClientRect();
        const ul = document.createElement("ul");
        ul.className = "path-complete-list";
        ul.style.top = `${rect.bottom + window.scrollY + 2}px`;
        ul.style.left = `${rect.left + window.scrollX}px`;

        items.forEach((item, i) => {
            const li = document.createElement("li");
            li.className = "path-complete-item";

            const iconEl = document.createElement("span");
            iconEl.className = "path-complete-icon";
            iconEl.innerHTML = getFileIcon(item.path, item.isDir);

            const lastSeg = item.path.replace(/\/$/, '').split('/').pop() ?? item.path;
            const label = document.createElement("span");
            label.className = "path-complete-label";
            label.textContent = lastSeg;
            li.title = item.path;

            li.append(iconEl, label);

            li.addEventListener("mousedown", (e) => {
                e.preventDefault();
                state.activeIndex = i;
                applySelection(item);
            });
            li.addEventListener("mousemove", () => { suppressMouseover = false; });
            li.addEventListener("mouseover", () => {
                if (suppressMouseover) { return; }
                state.activeIndex = i;
                updateActiveItem(state, PATH_ACTIVE_CLASS);
            });
            ul.appendChild(li);
        });

        document.body.appendChild(ul);
        state.el = ul;
        state.activeIndex = 0;
        updateActiveItem(state, PATH_ACTIVE_CLASS);
    }

    function triggerSuggest(code: HTMLElement): void {
        const query = (code.textContent ?? "").trim();
        if (!query || !PATH_PREFIX_REGEX.test(query)) {
            closeDropdown();
            return;
        }

        const id = `ps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        _pendingSuggestions.set(id, (items) => {
            const currentCode = getActiveInlineCode();
            if (currentCode === code) {
                showDropdown(code, items);
            }
        });
        notifyGetPathSuggestions(id, query);

        // 超时清理
        setTimeout(() => {
            if (_pendingSuggestions.has(id)) {
                _pendingSuggestions.delete(id);
            }
        }, PATH_SUGGESTION_TIMEOUT_MS);
    }

    // 键盘导航（capture 阶段，优先于编辑器处理）
    document.addEventListener("keydown", (e) => {
        if (!state.el) { return; }

        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closeDropdown();
            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            suppressMouseover = true;
            state.activeIndex = state.activeIndex >= lastItems.length - 1 ? 0 : state.activeIndex + 1;
            updateActiveItem(state, PATH_ACTIVE_CLASS);
            return;
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            suppressMouseover = true;
            state.activeIndex = state.activeIndex <= 0 ? lastItems.length - 1 : state.activeIndex - 1;
            updateActiveItem(state, PATH_ACTIVE_CLASS);
            return;
        }

        if (e.key === "Enter" || e.key === "Tab") {
            if (state.activeIndex >= 0 && state.activeIndex < lastItems.length) {
                e.preventDefault();
                e.stopPropagation();
                applySelection(lastItems[state.activeIndex]);
            }
            return;
        }
    }, true);

    // 输入时触发补全（debounce 200ms）
    document.addEventListener("keyup", (e) => {
        if (["Escape", "ArrowDown", "ArrowUp", "Enter", "Tab"].includes(e.key)) { return; }

        const code = getActiveInlineCode();
        if (!code) {
            closeDropdown();
            return;
        }

        if (debounceTimer) { clearTimeout(debounceTimer); }
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            triggerSuggest(code);
        }, PATH_DEBOUNCE_MS);
    });

    // 点击其他区域关闭下拉
    document.addEventListener("mousedown", (e) => {
        if (state.el && !state.el.contains(e.target as Node)) {
            closeDropdown();
        }
    }, true);

    // 失焦关闭
    window.addEventListener("blur", () => {
        closeDropdown();
    });
}
