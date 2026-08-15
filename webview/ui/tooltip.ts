// ─── Constants ────────────────────────────────────────────────────
const TOOLTIP_SPACING_PX = 6;
const TOOLTIP_VIEWPORT_MARGIN_PX = 4;

let tooltipEl: HTMLElement | null = null;

function getTooltip(): HTMLElement {
    if (!tooltipEl) {
        tooltipEl = document.createElement("div");
        tooltipEl.className = "custom-tooltip";
        document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
}

interface TooltipOptions {
    /** Display position: 'below' (default, used by the toolbar) or 'above' */
    placement?: "above" | "below";
    /** Show only when the text is truncated (showing '...') */
    truncatedOnly?: boolean;
}

interface TooltipHandle {
    /** Update the tooltip text dynamically (does not affect visibility) */
    setText(t: string): void;
    /** Imperatively show the tooltip (for scenarios like click feedback) */
    show(): void;
}

function position(
    tip: HTMLElement,
    el: HTMLElement,
    placement: "above" | "below",
): void {
    tip.style.visibility = "hidden";
    tip.style.display = "block";

    const elRect = el.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();

    let x = elRect.left + elRect.width / 2 - tipRect.width / 2;
    let y: number;

    if (placement === "above") {
        y = elRect.top - tipRect.height - TOOLTIP_SPACING_PX;
        if (y < TOOLTIP_VIEWPORT_MARGIN_PX) {
            y = elRect.bottom + TOOLTIP_SPACING_PX;
        } // Not enough room above → drop below
    } else {
        y = elRect.bottom + TOOLTIP_SPACING_PX;
        if (y + tipRect.height > window.innerHeight - TOOLTIP_VIEWPORT_MARGIN_PX) {
            y = elRect.top - tipRect.height - TOOLTIP_SPACING_PX;
        }
    }

    if (x + tipRect.width > window.innerWidth - TOOLTIP_VIEWPORT_MARGIN_PX) {
        x = window.innerWidth - tipRect.width - TOOLTIP_VIEWPORT_MARGIN_PX;
    }
    if (x < TOOLTIP_VIEWPORT_MARGIN_PX) {
        x = TOOLTIP_VIEWPORT_MARGIN_PX;
    }

    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.style.visibility = "visible";
}

/** Hide the currently-shown tooltip immediately (used after a click interaction to actively clear it) */
export function hideTooltip(): void {
    if (tooltipEl) {
        tooltipEl.style.display = "none";
    }
}

/** Imperative: show a tooltip next to the given element immediately, without binding events */
export function showTooltipAt(
    el: Element,
    text: string,
    placement: "above" | "below" = "above",
): void {
    const tip = getTooltip();
    tip.textContent = text;
    position(tip, el as HTMLElement, placement);
}

/** Replace the native title with a VSCode-style custom tooltip */
export function applyTooltip(
    el: HTMLElement,
    text: string,
    options: TooltipOptions = {},
): TooltipHandle {
    const { placement = "above", truncatedOnly = false } = options;
    let currentText = text;

    el.removeAttribute("title");

    el.addEventListener("mouseenter", () => {
        if (!currentText) {
            return;
        }
        if (truncatedOnly && el.scrollWidth <= el.offsetWidth) {
            return;
        }
        const tip = getTooltip();
        tip.textContent = currentText;
        position(tip, el, placement);
    });

    el.addEventListener("mouseleave", () => {
        if (tooltipEl) {
            tooltipEl.style.display = "none";
        }
    });

    return {
        setText(t: string) {
            currentText = t;
        },
        show() {
            if (!currentText) {
                return;
            }
            const tip = getTooltip();
            tip.textContent = currentText;
            position(tip, el, placement);
        },
    };
}
