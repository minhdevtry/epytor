// ─── 通用下拉补全组件 ────────────────────────────────────────
// imgPathComplete 和 pathComplete 共享的下拉管理逻辑

export interface DropdownState {
    el: HTMLUListElement | null;
    activeIndex: number;
}

/** 关闭下拉并重置状态 */
export function closeDropdown(state: DropdownState): void {
    if (state.el) {
        state.el.remove();
        state.el = null;
    }
    state.activeIndex = -1;
}

/** 刷新激活项高亮样式 */
export function updateActiveItem(state: DropdownState, activeClass: string): void {
    if (!state.el) { return; }
    Array.from(state.el.children).forEach((li, i) => {
        const isActive = i === state.activeIndex;
        li.classList.toggle(activeClass, isActive);
        if (isActive) {
            (li as HTMLElement).scrollIntoView({ block: "nearest" });
        }
    });
}
