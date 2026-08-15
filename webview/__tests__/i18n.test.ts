import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadI18n(
    translations: Record<string, string> = {},
    isMac = false,
) {
    window.__i18n = { translations, isMac };
    vi.resetModules();
    return import("../../webview/i18n");
}

describe("WebView i18n", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete window.__i18n;
    });

    it("should return the translation when one exists", async () => {
        const { t } = await loadI18n({ Save: "Speichern" });

        expect(t("Save")).toBe("Speichern");
    });

    it("should return the original key when no translation exists", async () => {
        const { t } = await loadI18n();

        expect(t("Missing translation")).toBe("Missing translation");
    });

    it("should convert Mac shortcuts with modifier keys into a separator-less symbol form", async () => {
        const { kbd } = await loadI18n({}, true);

        expect(kbd("Mod-Shift-Alt-z")).toBe("⌘⇧⌥Z");
    });

    it("should convert Windows shortcuts with modifier keys into a plus-separated text form", async () => {
        const { kbd } = await loadI18n();

        expect(kbd("Mod-Shift-Alt-z")).toBe("Ctrl+Shift+Alt+Z");
    });

    it("should fall back to English and Windows defaults when no config is injected", async () => {
        vi.resetModules();
        const { kbd, t } = await import("../../webview/i18n");

        expect(t("Save")).toBe("Save");
        expect(kbd("Mod-b")).toBe("Ctrl+B");
    });
});