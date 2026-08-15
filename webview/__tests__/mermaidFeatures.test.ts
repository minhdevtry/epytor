import { describe, it, expect, vi } from "vitest";
import { getMermaidConfig } from "../utils/mermaidThemes";
import { downloadBlob } from "../utils/mermaidExport";

describe("mermaidThemes", () => {
    it("in Dark mode returns the base theme and dark themeVariables", () => {
        const cfg = getMermaidConfig(true);
        expect(cfg.theme).toBe("base");
        expect(cfg.themeVariables?.darkMode).toBe(true);
        expect(cfg.themeVariables?.primaryColor).toBe("#1e293b");
        expect(cfg.themeVariables?.actorBorder).toBe("#3b82f6");
        expect(cfg.flowchart?.curve).toBe("basis");
    });

    it("in Light mode returns the base theme and light themeVariables", () => {
        const cfg = getMermaidConfig(false);
        expect(cfg.theme).toBe("base");
        expect(cfg.themeVariables?.darkMode).toBe(false);
        expect(cfg.themeVariables?.primaryColor).toBe("#f8fafc");
        expect(cfg.themeVariables?.primaryTextColor).toBe("#0f172a");
        expect(cfg.flowchart?.curve).toBe("basis");
    });
});

describe("mermaidExport", () => {
    it("downloadBlob 应创建 a 标签触发下载并清理", () => {
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
        const blob = new Blob(["test"], { type: "text/plain" });
        expect(() => downloadBlob(blob, "test.txt")).not.toThrow();
        expect(clickSpy).toHaveBeenCalled();
        clickSpy.mockRestore();
    });
});
