import { beforeEach, describe, expect, it } from "vitest";
import {
    collapsedHeadingPositions,
    isHeadingFolded,
    toggleHeadingFold,
    expandAllHeadings,
} from "../plugins/headingFoldPlugin";

describe("headingFoldPlugin", () => {
    beforeEach(() => {
        collapsedHeadingPositions.clear();
    });

    it("should report heading as not folded by default", () => {
        expect(isHeadingFolded(10)).toBe(false);
        expect(isHeadingFolded(45)).toBe(false);
    });

    it("should toggle heading fold state correctly", () => {
        const mockView = {
            state: {
                tr: {
                    setMeta: () => {},
                },
            },
            dispatch: () => {},
        } as any;

        toggleHeadingFold(mockView, 10);
        expect(isHeadingFolded(10)).toBe(true);

        toggleHeadingFold(mockView, 10);
        expect(isHeadingFolded(10)).toBe(false);
    });

    it("should expand all headings when requested", () => {
        collapsedHeadingPositions.add(10);
        collapsedHeadingPositions.add(50);
        collapsedHeadingPositions.add(120);

        expect(isHeadingFolded(10)).toBe(true);
        expect(isHeadingFolded(50)).toBe(true);
        expect(isHeadingFolded(120)).toBe(true);

        const mockView = {
            state: {
                tr: {
                    setMeta: () => {},
                },
            },
            dispatch: () => {},
        } as any;

        expandAllHeadings(mockView);

        expect(isHeadingFolded(10)).toBe(false);
        expect(isHeadingFolded(50)).toBe(false);
        expect(isHeadingFolded(120)).toBe(false);
        expect(collapsedHeadingPositions.size).toBe(0);
    });
});
