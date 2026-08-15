import type { Ctx } from "@milkdown/kit/ctx";
import { editorViewCtx } from "@milkdown/kit/core";

export function promptVideoInsert(type: "youtube" | "video", ctx: Ctx): void {
    const overlay = document.createElement("div");
    overlay.className = "video-prompt-modal";

    const isYT = type === "youtube";
    const titleText = isYT ? "🎥 Insert YouTube Video" : "🎬 Insert Video Player";
    const placeholderText = isYT
        ? "Paste YouTube link (e.g. https://www.youtube.com/watch?v=... or https://youtu.be/...)"
        : "Paste video link / path (MP4, WebM, URL...)";

    overlay.innerHTML = `
        <div class="video-prompt-backdrop"></div>
        <div class="video-prompt-dialog">
            <div class="video-prompt-header">
                <div class="video-prompt-title">${titleText}</div>
                <button class="video-prompt-close">✕</button>
            </div>
            <div class="video-prompt-body">
                <input type="text" class="video-prompt-input" placeholder="${placeholderText}" />
                <div class="video-prompt-tip">${isYT ? "Supports regular videos, Shorts, and embed links" : "Supports direct video URLs or relative video file paths"}</div>
            </div>
            <div class="video-prompt-footer">
                <button class="video-prompt-cancel">Cancel</button>
                <button class="video-prompt-confirm">Insert</button>
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
        if (!url) {
            close();
            return;
        }

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
        if (e.key === "Enter") {
            e.preventDefault();
            confirm();
        }
        if (e.key === "Escape") {
            e.preventDefault();
            close();
        }
    });
    overlay.querySelector(".video-prompt-backdrop")?.addEventListener("click", close);
}
