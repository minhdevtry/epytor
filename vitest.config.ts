import { defineConfig } from "vitest/config";
import path from "path";

const alias = {
    // 将 vscode 模块重定向到 mock 实现，Extension 侧单元测试所需
    vscode: path.resolve(__dirname, "__mocks__/vscode.ts"),
    "@": path.resolve(__dirname, "webview"),
};

export default defineConfig({
    resolve: { alias },
    test: {
        projects: [
            {
                extends: true,
                test: {
                    name: "extension",
                    environment: "node",
                    include: ["src/__tests__/**/*.test.ts", "shared/__tests__/**/*.test.ts"],
                },
            },
            {
                extends: true,
                test: {
                    name: "webview",
                    environment: "jsdom",
                    include: ["webview/__tests__/**/*.test.ts"],
                    setupFiles: ["./webview/__tests__/setup.ts"],
                },
            },
        ],
        coverage: {
            provider: "v8",
            reporter: ["text", "lcov", "html"],
            include: [
                "src/utils/**/*.ts",
                "src/MarkdownDocument.ts",
                "webview/i18n/**/*.ts",
                "webview/utils/**/*.ts",
            ],
            thresholds: {
                lines: 70,
                functions: 70,
            },
        },
    },
});
