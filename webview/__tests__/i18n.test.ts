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

    it("翻译存在时 应该 返回对应译文", async () => {
        const { t } = await loadI18n({ Save: "保存" });

        expect(t("Save")).toBe("保存");
    });

    it("翻译不存在时 应该 返回原始 key", async () => {
        const { t } = await loadI18n();

        expect(t("Missing translation")).toBe("Missing translation");
    });

    it("Mac 快捷键包含修饰键时 应该 转为无分隔符符号", async () => {
        const { kbd } = await loadI18n({}, true);

        expect(kbd("Mod-Shift-Alt-z")).toBe("⌘⇧⌥Z");
    });

    it("Windows 快捷键包含修饰键时 应该 转为加号分隔文本", async () => {
        const { kbd } = await loadI18n();

        expect(kbd("Mod-Shift-Alt-z")).toBe("Ctrl+Shift+Alt+Z");
    });

    it("未注入配置时 应该 使用英文与 Windows 默认值", async () => {
        vi.resetModules();
        const { kbd, t } = await import("../../webview/i18n");

        expect(t("Save")).toBe("Save");
        expect(kbd("Mod-b")).toBe("Ctrl+B");
    });
});