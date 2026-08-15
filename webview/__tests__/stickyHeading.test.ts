import { beforeEach, describe, expect, it, vi } from "vitest";
import { initStickyHeading } from "../components/stickyHeading";

describe("stickyHeading component", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("should initialize sticky heading bar element in document body", () => {
        const { bar } = initStickyHeading(() => null);
        expect(bar).toBeDefined();
        expect(bar.className).toContain("epytor-sticky-heading-bar");
        expect(document.querySelector(".epytor-sticky-heading-bar")).not.toBeNull();
    });

    it("should remain hidden when no editor view is available", () => {
        const { bar, update } = initStickyHeading(() => null);
        update();
        expect(bar.classList.contains("is-visible")).toBe(false);
    });

    it("should display heading info when scroll position is past a heading", () => {
        const mockHeadingDom = document.createElement("h2");
        mockHeadingDom.textContent = "Architecture Overview";
        mockHeadingDom.getBoundingClientRect = () => ({
            top: 20,
            bottom: 60,
            left: 0,
            right: 800,
            width: 800,
            height: 40,
            x: 0,
            y: 20,
            toJSON: () => {},
        });

        const mockView = {
            state: {
                doc: {
                    descendants: (cb: any) => {
                        cb({
                            type: { name: "heading" },
                            attrs: { level: 2 },
                            textContent: "Architecture Overview",
                        }, 10);
                    },
                },
            },
            nodeDOM: (pos: number) => {
                if (pos === 10) return mockHeadingDom;
                return null;
            },
        } as any;

        // Mock window.scrollY > 80
        Object.defineProperty(window, "scrollY", { value: 150, writable: true });

        const { bar, update } = initStickyHeading(() => mockView);
        update();

        expect(bar.classList.contains("is-visible")).toBe(true);
        const levelBadge = bar.querySelector(".epytor-sticky-level");
        const titleSpan = bar.querySelector(".epytor-sticky-title");

        expect(levelBadge?.textContent).toBe("H2");
        expect(titleSpan?.textContent).toBe("Architecture Overview");
    });
});
