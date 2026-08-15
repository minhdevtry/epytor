import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const styleCss = readFileSync(
    path.resolve(process.cwd(), "webview/style.css"),
    "utf-8",
);

describe("WebView styles", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.head.innerHTML = `<style>${styleCss}</style>`;
        document.body.innerHTML = "";
    });

    it("should allow menus to overflow the top bar container when a pop-up menu is present", () => {
        document.body.innerHTML = `
            <div class="milkdown">
                <div class="milkdown-top-bar">
                    <div class="top-bar-inner">
                        <div class="top-bar-heading-selector">
                            <div class="top-bar-heading-dropdown"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        const inner = document.querySelector<HTMLElement>(".top-bar-inner");

        expect(inner).not.toBeNull();
        expect(getComputedStyle(inner!).overflow).toBe("visible");
    });
});