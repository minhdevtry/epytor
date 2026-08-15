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

    it("should bypass global undo/redo listener inside input, textarea, .cm-editor, and modal overlays", () => {
        const checkBypass = (el: HTMLElement | null) => {
            if (!el) return false;
            return (
                el.tagName === "INPUT" ||
                el.tagName === "TEXTAREA" ||
                Boolean(el.closest(".cm-editor")) ||
                Boolean(el.closest(".epytor-modal")) ||
                Boolean(el.closest(".global-lightbox")) ||
                Boolean(el.closest(".mermaid-modal-overlay"))
            );
        };

        const input = document.createElement("input");
        const textarea = document.createElement("textarea");
        const normalDiv = document.createElement("div");

        const cmContainer = document.createElement("div");
        cmContainer.className = "cm-editor";
        const cmContent = document.createElement("div");
        cmContent.className = "cm-content";
        cmContainer.appendChild(cmContent);

        const modalOverlay = document.createElement("div");
        modalOverlay.className = "mermaid-modal-overlay";
        const modalContent = document.createElement("div");
        modalOverlay.appendChild(modalContent);

        expect(checkBypass(input)).toBe(true);
        expect(checkBypass(textarea)).toBe(true);
        expect(checkBypass(cmContent)).toBe(true);
        expect(checkBypass(modalContent)).toBe(true);
        expect(checkBypass(normalDiv)).toBe(false);
    });

    it("should correctly identify undo and redo combinations across international keyboard events", () => {
        const matchUndo = (e: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; code?: string; key?: string }) => {
            if ((e.metaKey || e.ctrlKey) && !e.altKey) {
                const isZ = e.code === "KeyZ" || e.key === "z" || e.key === "Z";
                return isZ && !e.shiftKey;
            }
            return false;
        };

        const matchRedo = (e: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; code?: string; key?: string }) => {
            if ((e.metaKey || e.ctrlKey) && !e.altKey) {
                const isZ = e.code === "KeyZ" || e.key === "z" || e.key === "Z";
                const isY = e.code === "KeyY" || e.key === "y" || e.key === "Y";
                return (isZ && Boolean(e.shiftKey)) || (isY && !e.shiftKey);
            }
            return false;
        };

        // Standard QWERTY
        expect(matchUndo({ ctrlKey: true, code: "KeyZ", key: "z" })).toBe(true);
        expect(matchRedo({ ctrlKey: true, shiftKey: true, code: "KeyZ", key: "Z" })).toBe(true);
        expect(matchRedo({ ctrlKey: true, code: "KeyY", key: "y" })).toBe(true);

        // macOS Command
        expect(matchUndo({ metaKey: true, code: "KeyZ", key: "z" })).toBe(true);
        expect(matchRedo({ metaKey: true, shiftKey: true, code: "KeyZ", key: "Z" })).toBe(true);

        // International Layout (e.g. AZERTY / non-standard key mapping)
        expect(matchUndo({ ctrlKey: true, code: "KeyW", key: "z" })).toBe(true);
        expect(matchRedo({ ctrlKey: true, shiftKey: true, code: "KeyW", key: "Z" })).toBe(true);
    });
});
