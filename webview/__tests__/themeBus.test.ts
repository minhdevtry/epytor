import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadThemeBus() {
    vi.resetModules();
    return import("../../webview/utils/themeBus");
}

describe("themeBus", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.className = "";
    });

    it("should call back with false immediately when subscribed under a light theme", async () => {
        const { onThemeChange } = await loadThemeBus();
        const listener = vi.fn();

        const unsubscribe = onThemeChange(listener);

        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith(false);
        unsubscribe();
    });

    it.each(["vscode-dark", "vscode-high-contrast"])(
        "should call back with true immediately when subscribed under the %s theme",
        async (themeClass) => {
            document.body.className = themeClass;
            const { onThemeChange } = await loadThemeBus();
            const listener = vi.fn();

            const unsubscribe = onThemeChange(listener);

            expect(listener).toHaveBeenCalledWith(true);
            unsubscribe();
        },
    );

    it("should notify subscribers once when the theme's light/dark state changes", async () => {
        const { onThemeChange } = await loadThemeBus();
        const listener = vi.fn();
        const unsubscribe = onThemeChange(listener);

        document.body.className = "vscode-dark";

        await vi.waitFor(() => {
            expect(listener).toHaveBeenCalledTimes(2);
        });
        expect(listener).toHaveBeenLastCalledWith(true);
        unsubscribe();
    });

    it("should not notify again when only the theme variant changes but the light/dark state stays the same", async () => {
        document.body.className = "vscode-dark";
        const { onThemeChange } = await loadThemeBus();
        const listener = vi.fn();
        const unsubscribe = onThemeChange(listener);

        document.body.className = "vscode-high-contrast";

        await new Promise<void>((resolve) => {
            queueMicrotask(resolve);
        });
        expect(listener).toHaveBeenCalledOnce();
        unsubscribe();
    });

    it("should stop notifying the subscriber after unsubscribe", async () => {
        const { onThemeChange } = await loadThemeBus();
        const listener = vi.fn();
        const unsubscribe = onThemeChange(listener);
        unsubscribe();

        document.body.className = "vscode-dark";

        await new Promise<void>((resolve) => {
            queueMicrotask(resolve);
        });
        expect(listener).toHaveBeenCalledOnce();
    });
});