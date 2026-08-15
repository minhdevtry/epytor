import { describe, it, expect } from "vitest";
import { CrepeBuilder } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { markHighlightPlugin } from "../plugins/markHighlightPlugin";
import { videoDecorationPlugin } from "../plugins/videoDecorationPlugin";

describe("markHighlightPlugin & videoDecorationPlugin test", () => {
    it("decorates parsed HTML mark tags and inline text mark tags", async () => {
        const container = document.createElement("div");
        document.body.appendChild(container);

        const crepe = new CrepeBuilder({
            root: container,
            defaultValue: "<mark>aasff</mark>\n\n<mark style=\"background-color: #4ade80;\">green highlight</mark>\n\nText with <mark>inline mark</mark> inside.",
        });
        crepe.editor.use(markHighlightPlugin);

        const editor = await crepe.create();
        editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const html = view.dom.innerHTML;
            expect(html).toContain("text-highlight-inline");
            expect(html).toContain("aasff");
            expect(html).toContain("green highlight");
        });
    });

    it("decorates YouTube iframe and standalone URL", async () => {
        const container = document.createElement("div");
        document.body.appendChild(container);

        const crepe = new CrepeBuilder({
            root: container,
            defaultValue: "<iframe src=\"https://www.youtube.com/embed/dQw4w9WgXcQ\"></iframe>\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ",
        });
        crepe.editor.use(videoDecorationPlugin);

        const editor = await crepe.create();
        editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const html = view.dom.innerHTML;
            expect(html).toContain("embedded-video-container");
            expect(html).toContain("YouTube Player (dQw4w9WgXcQ)");
            expect(html).toContain("https://www.youtube.com/embed/dQw4w9WgXcQ");
        });
    });
});
