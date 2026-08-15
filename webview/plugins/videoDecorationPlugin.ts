import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

export const videoPluginKey = new PluginKey("video_decorations");

/**
 * Validate URL to prevent XSS attacks (e.g. javascript: or data:text/html payloads).
 */
export function isSafeEmbedUrl(url: string): boolean {
    const trimmed = url.trim();
    if (!trimmed) return false;
    if (/^https?:\/\//i.test(trimmed)) return true;
    if (/^vscode-webview(-resource)?:\/\//i.test(trimmed)) return true;
    if (/^(\.|\/|[a-zA-Z0-9_-])/i.test(trimmed) && !/^[a-zA-Z][a-zA-Z0-9+\-.]*:/i.test(trimmed)) {
        return true;
    }
    return false;
}

function escapeAttribute(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function createYouTubeWidget(videoId: string): HTMLElement {
    const widget = document.createElement("div");
    widget.className = "embedded-video-container";
    widget.dataset.videoId = videoId;
    widget.innerHTML = `
        <div class="video-toolbar-bar">
            <div class="video-toolbar-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#ff0000" style="vertical-align:middle;margin-right:6px"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                <span>YouTube Player (${videoId})</span>
            </div>
            <div class="video-toolbar-actions">
                <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" class="video-action-btn" title="Open on YouTube">🌐 Open Tab</a>
            </div>
        </div>
        <div class="video-iframe-wrapper">
            <iframe 
                src="https://www.youtube.com/embed/${videoId}" 
                title="YouTube video player" 
                frameborder="0" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                allowfullscreen>
            </iframe>
        </div>
    `;
    return widget;
}

function createIframeWidget(src: string): HTMLElement {
    const safeSrc = escapeAttribute(src);
    const widget = document.createElement("div");
    widget.className = "embedded-video-container";
    widget.innerHTML = `
        <div class="video-iframe-wrapper">
            <iframe src="${safeSrc}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
        </div>
    `;
    return widget;
}

function createVideoWidget(src: string): HTMLElement {
    const safeSrc = escapeAttribute(src);
    const widget = document.createElement("div");
    widget.className = "embedded-video-container";
    widget.innerHTML = `
        <div class="video-iframe-wrapper">
            <video src="${safeSrc}" controls></video>
        </div>
    `;
    return widget;
}

export const videoDecorationPlugin = $prose(() => {
    return new Plugin({
        key: videoPluginKey,
        props: {
            decorations(state) {
                const decos: Decoration[] = [];

                state.doc.descendants((node, pos) => {
                    if (node.type.name === "code_block") return false;

                    // 1. Parsed HTML block/inline nodes (<iframe...> or <video...>)
                    if (node.type.name === "html") {
                        const val = ((node.attrs?.value as string) || "").trim();
                        if (!val) return false;

                        // 1a. Check for YouTube embed in HTML
                        const ytMatch = val.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([\w-]{11})/i);
                        if (ytMatch && /^[\w-]{11}$/.test(ytMatch[1])) {
                            const videoId = ytMatch[1];
                            const widget = createYouTubeWidget(videoId);
                            decos.push(Decoration.widget(pos, widget, { side: 1 }));
                            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "video-source-text-hidden" }));
                            return false;
                        }

                        // 1b. Generic <iframe src="...">
                        const iframeMatch = val.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
                        if (iframeMatch && isSafeEmbedUrl(iframeMatch[1])) {
                            const widget = createIframeWidget(iframeMatch[1]);
                            decos.push(Decoration.widget(pos, widget, { side: 1 }));
                            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "video-source-text-hidden" }));
                            return false;
                        }

                        // 1c. Generic <video src="...">
                        const videoMatch = val.match(/<video[^>]*\ssrc=["']([^"']+)["']/i);
                        if (videoMatch && isSafeEmbedUrl(videoMatch[1])) {
                            const widget = createVideoWidget(videoMatch[1]);
                            decos.push(Decoration.widget(pos, widget, { side: 1 }));
                            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "video-source-text-hidden" }));
                            return false;
                        }
                        return false;
                    }

                    // 2. Standalone YouTube URL in a paragraph
                    if (node.type.name === "paragraph") {
                        const fullText = (node.textContent || "").trim();
                        // Check if paragraph is just a YouTube link
                        const ytUrlRegex = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([\w-]{11})(?:\S*)?$/i;
                        const match = fullText.match(ytUrlRegex);
                        if (match && /^[\w-]{11}$/.test(match[1])) {
                            const videoId = match[1];
                            const widget = createYouTubeWidget(videoId);
                            decos.push(Decoration.widget(pos + 1, widget, { side: -1 }));
                            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "video-block-node" }));
                            if (node.nodeSize > 2) {
                                decos.push(Decoration.inline(pos + 1, pos + node.nodeSize - 1, { class: "video-source-text-hidden" }));
                            }
                            return false; // Skip children to prevent duplicates
                        }
                    }
                });

                return DecorationSet.create(state.doc, decos);
            },
        },
    });
});
