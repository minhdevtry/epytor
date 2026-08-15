import type { Ctx } from "@milkdown/kit/ctx";
import { editorViewCtx } from "@milkdown/kit/core";

export function showHighlightColorPalette(anchorEl: HTMLElement | null, ctx: Ctx): void {
    const existing = document.querySelector(".highlight-color-picker-popover");
    if (existing) {
        existing.remove();
        return;
    }

    const popover = document.createElement("div");
    popover.className = "highlight-color-picker-popover";

    const colors = [
        { label: "Yellow", color: "rgba(250, 204, 21, 0.45)", hex: "#fde047" },
        { label: "Green", color: "rgba(74, 222, 128, 0.45)", hex: "#4ade80" },
        { label: "Blue", color: "rgba(96, 165, 250, 0.45)", hex: "#60a5fa" },
        { label: "Pink", color: "rgba(244, 114, 182, 0.45)", hex: "#f472b6" },
        { label: "Purple", color: "rgba(192, 132, 252, 0.45)", hex: "#c084fc" },
        { label: "Orange", color: "rgba(251, 146, 60, 0.45)", hex: "#fb923c" },
        { label: "Red", color: "rgba(248, 113, 113, 0.45)", hex: "#f87171" },
    ];

    const swatchesHtml = colors
        .map(
            (c) =>
                `<button type="button" class="hl-color-swatch" data-color="${c.color}" title="${c.label}" style="background-color: ${c.hex};"></button>`,
        )
        .join("");

    popover.innerHTML = `
        <div class="hl-swatches-title">Select Highlight Color</div>
        <div class="hl-swatches">${swatchesHtml}</div>
        <div class="hl-custom-row">
            <label class="hl-custom-label">
                <input type="color" class="hl-custom-input" value="#fde047" title="Custom color" />
                <span>Custom</span>
            </label>
            <button type="button" class="hl-clear-btn" title="Remove highlight">🚫 Clear</button>
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

    const close = () => {
        document.removeEventListener("click", onDocClick);
        document.removeEventListener("keydown", onKeyDown);
        if (popover.parentNode) popover.parentNode.removeChild(popover);
    };

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
