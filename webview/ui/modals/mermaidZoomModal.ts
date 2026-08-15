export function showMermaidZoomModal(svgContent: string, rawCode: string): void {
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
                <div class="mermaid-zoom-title">📊 Mermaid Diagram (Zoom & Pan)</div>
                <div class="mermaid-zoom-actions">
                    <button class="mzm-btn mzm-zoom-in" title="Zoom In (+)">➕ Zoom in</button>
                    <button class="mzm-btn mzm-zoom-out" title="Zoom Out (-)">➖ Zoom out</button>
                    <button class="mzm-btn mzm-zoom-reset" title="Reset (100%)">1:1</button>
                    <button class="mzm-btn mzm-copy" title="Copy Mermaid Code">📋 Copy Code</button>
                    <button class="mzm-btn mzm-close" title="Close (Esc)">✕</button>
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
