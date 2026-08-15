import { describe, it, expect } from "vitest";
import { isSafeEmbedUrl } from "../plugins/videoDecorationPlugin";

describe("videoDecorationPlugin - isSafeEmbedUrl", () => {
    it("hợp lệ với đường dẫn https", () => {
        expect(isSafeEmbedUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(true);
        expect(isSafeEmbedUrl("https://example.com/video.mp4")).toBe(true);
    });

    it("hợp lệ với đường dẫn http", () => {
        expect(isSafeEmbedUrl("http://example.com/video.mp4")).toBe(true);
    });

    it("hợp lệ với đường dẫn nội bộ vscode-webview", () => {
        expect(isSafeEmbedUrl("vscode-webview-resource://authority/path/video.mp4")).toBe(true);
    });

    it("hợp lệ với đường dẫn tương đối", () => {
        expect(isSafeEmbedUrl("./assets/video.mp4")).toBe(true);
        expect(isSafeEmbedUrl("../video.mp4")).toBe(true);
    });

    it("từ chối URL nguy hiểm javascript:", () => {
        expect(isSafeEmbedUrl("javascript:alert(1)")).toBe(false);
        expect(isSafeEmbedUrl("javascript:void(0)")).toBe(false);
    });

    it("từ chối chuỗi rỗng", () => {
        expect(isSafeEmbedUrl("")).toBe(false);
        expect(isSafeEmbedUrl("   ")).toBe(false);
    });
});
