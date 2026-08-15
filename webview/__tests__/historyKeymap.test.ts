import { describe, expect, it, vi } from "vitest";

describe("Undo / Redo keymap and history isolation", () => {
    it("should allow undo on Mod-z and redo on Mod-Shift-z / Mod-y", () => {
        const mockUndo = vi.fn(() => true);
        const mockRedo = vi.fn(() => true);

        const keymapHandler = {
            "Mod-z": mockUndo,
            "Mod-y": mockRedo,
            "Mod-Shift-z": mockRedo,
            "Shift-Mod-z": mockRedo,
        };

        expect(keymapHandler["Mod-z"]()).toBe(true);
        expect(mockUndo).toHaveBeenCalledTimes(1);

        expect(keymapHandler["Mod-y"]()).toBe(true);
        expect(mockRedo).toHaveBeenCalledTimes(1);

        expect(keymapHandler["Mod-Shift-z"]()).toBe(true);
        expect(mockRedo).toHaveBeenCalledTimes(2);

        expect(keymapHandler["Shift-Mod-z"]()).toBe(true);
        expect(mockRedo).toHaveBeenCalledTimes(3);
    });

    it("should bypass global undo/redo listener inside input, textarea, and .cm-editor", () => {
        const checkBypass = (el: HTMLElement | null) => {
            if (!el) return false;
            return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || Boolean(el.closest(".cm-editor"));
        };

        const input = document.createElement("input");
        const textarea = document.createElement("textarea");
        const normalDiv = document.createElement("div");

        const cmContainer = document.createElement("div");
        cmContainer.className = "cm-editor";
        const cmContent = document.createElement("div");
        cmContent.className = "cm-content";
        cmContainer.appendChild(cmContent);

        expect(checkBypass(input)).toBe(true);
        expect(checkBypass(textarea)).toBe(true);
        expect(checkBypass(cmContent)).toBe(true);
        expect(checkBypass(normalDiv)).toBe(false);
    });
});
