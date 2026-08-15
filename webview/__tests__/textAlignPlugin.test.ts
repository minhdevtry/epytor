import { describe, expect, it } from "vitest";
import { getAlignFromText, cycleAlignment } from "../plugins/textAlignPlugin";

describe("textAlignPlugin", () => {
    it("should parse align attribute from HTML paragraph tags correctly", () => {
        expect(getAlignFromText('<p align="center">Centered text</p>')).toBe("center");
        expect(getAlignFromText('<p align="right">Right text</p>')).toBe("right");
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

    it("should cycle alignment through left -> center -> right -> left", () => {
        let currentAlignText = "Simple text";
        const mockView = {
            state: {
                selection: { from: 1, to: 5 },
                doc: {
                    nodesBetween: (from: number, to: number, cb: any) => {
                        cb({
                            isBlock: true,
                            textContent: currentAlignText,
                            nodeSize: currentAlignText.length + 2,
                            type: { name: "paragraph" },
                        }, 0);
                    },
                },
                tr: {
                    replaceWith: (_start: number, _end: number, node: any) => {
                        currentAlignText = node.text;
                    },
                },
                schema: {
                    text: (t: string) => ({ text: t }),
                },
            },
            dispatch: () => {},
        } as any;

        // Default -> center
        const next1 = cycleAlignment(mockView);
        expect(next1).toBe("center");

        // center -> right
        const next2 = cycleAlignment(mockView);
        expect(next2).toBe("right");

        // right -> left
        const next3 = cycleAlignment(mockView);
        expect(next3).toBe("left");
    });
});
