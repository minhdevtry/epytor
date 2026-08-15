import { describe, it, expect } from "vitest";
import { slugify } from "../../webview/utils/slug";

describe("slugify", () => {
    it("lowercases English text", () => {
        expect(slugify("Hello World")).toBe("hello-world");
    });

    it("replaces spaces with hyphens", () => {
        expect(slugify("foo bar baz")).toBe("foo-bar-baz");
    });

    it("keeps Latin characters (full alphabet) as-is", () => {
        expect(slugify("Section Title Example")).toBe("section-title-example");
    });

    it("handles mixed letters and English words", () => {
        expect(slugify("H2 Section Title Example")).toBe("h2-section-title-example");
    });

    it("removes emoji", () => {
        // Emoji is not in the \p{L}\p{N}_- range, so it is removed; spaces become -
        expect(slugify("🚀 Emoji Title")).toBe("-emoji-title");
    });

    it("removes symbols like colons and keeps adjacent hyphens (GitHub rule)", () => {
        expect(slugify("Special Chars : and &")).toBe("special-chars--and-");
    });

    it("leaves already-lowercase text unchanged", () => {
        expect(slugify("lowercase")).toBe("lowercase");
    });

    it("returns an empty string for an empty string", () => {
        expect(slugify("")).toBe("");
    });

    it("returns an empty string for an all-symbol input", () => {
        expect(slugify("!!!@@@###")).toBe("");
    });

    it("keeps digits", () => {
        expect(slugify("Chapter 1")).toBe("chapter-1");
    });

    it("keeps hyphens and underscores as-is", () => {
        expect(slugify("some-_-slug")).toBe("some-_-slug");
    });

    it("keeps alphabetic characters (full word) as-is", () => {
        const result = slugify("Hello World Example");
        expect(result).toBe("hello-world-example");
    });
});
