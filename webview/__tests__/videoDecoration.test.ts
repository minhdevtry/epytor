import { describe, it, expect } from "vitest";
import { isSafeEmbedUrl } from "../plugins/videoDecorationPlugin";

describe("videoDecorationPlugin - isSafeEmbedUrl", () => {
    it("accepts https URLs", () => {
        expect(isSafeEmbedUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(true);
        expect(isSafeEmbedUrl("https://example.com/video.mp4")).toBe(true);
    });

    it("accepts http URLs", () => {
        expect(isSafeEmbedUrl("http://example.com/video.mp4")).toBe(true);
    });

    it("accepts internal vscode-webview URLs", () => {
        expect(isSafeEmbedUrl("vscode-webview-resource://authority/path/video.mp4")).toBe(true);
    });

    it("accepts relative paths", () => {
        expect(isSafeEmbedUrl("./assets/video.mp4")).toBe(true);
        expect(isSafeEmbedUrl("../video.mp4")).toBe(true);
    });

    it("rejects dangerous javascript: URLs", () => {
        expect(isSafeEmbedUrl("javascript:alert(1)")).toBe(false);
        expect(isSafeEmbedUrl("javascript:void(0)")).toBe(false);
    });

    it("rejects empty strings", () => {
        expect(isSafeEmbedUrl("")).toBe(false);
        expect(isSafeEmbedUrl("   ")).toBe(false);
    });
});
