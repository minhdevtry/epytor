import { describe, expect, it } from "vitest";
import { getAlignFromText } from "../plugins/textAlignPlugin";

describe("textAlignPlugin", () => {
    it("should parse align attribute from HTML paragraph tags correctly", () => {
        expect(getAlignFromText('<p align="center">Centered text</p>')).toBe("center");
        expect(getAlignFromText('<p align="right">Right text</p>')).toBe("right");
        expect(getAlignFromText('<p align="justify">Justified text</p>')).toBe("justify");
        expect(getAlignFromText('<p align="left">Left text</p>')).toBe("left");
    });

    it("should parse align attribute from div and heading tags", () => {
        expect(getAlignFromText('<div align="center">Block</div>')).toBe("center");
        expect(getAlignFromText('<h2 align="right">Heading</h2>')).toBe("right");
    });

    it("should parse text-align inline styles", () => {
        expect(getAlignFromText('<p style="text-align: center;">Hello</p>')).toBe("center");
        expect(getAlignFromText('<p style="text-align: right">World</p>')).toBe("right");
    });

    it("should return null when no alignment tag is present", () => {
        expect(getAlignFromText("Normal plain markdown text")).toBeNull();
        expect(getAlignFromText("<p>Standard paragraph</p>")).toBeNull();
    });
});
