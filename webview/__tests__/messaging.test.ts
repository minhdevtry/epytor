/**
 * messaging.ts tests: verify that the message-sending functions call postMessage with the correct format.
 * acquireVsCodeApi is injected into globalThis by setup.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockVscodeApi } from "./setup";

// Lazy import to make sure acquireVsCodeApi has been injected by setup.ts
const {
    notifyReady,
    notifyUpdate,
    notifyOpenUrl,
    notifyOpenFile,
    notifySwitchToTextEditor,
    notifyUploadImage,
    notifyGetProjectImages,
    notifyGetPathSuggestions,
    notifyResolveImagePath,
    notifyRenameImage,
    notifyOpenSettings,
} = await import("../../webview/messaging");

describe("messaging — postMessage format verification", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("notifyReady sends { type: 'ready' }", () => {
        notifyReady();
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({ type: "ready" });
    });

    it("notifyUpdate carries the content field", () => {
        notifyUpdate("# Hello");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "update",
            content: "# Hello",
        });
    });

    it("notifyOpenUrl carries the url field", () => {
        notifyOpenUrl("https://example.com");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "openUrl",
            url: "https://example.com",
        });
    });

    it("notifyOpenFile carries the path field", () => {
        notifyOpenFile("./docs/README.md");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "openFile",
            path: "./docs/README.md",
        });
    });

    it("notifySwitchToTextEditor does not send the line field when line is absent", () => {
        notifySwitchToTextEditor();
        const msg = mockVscodeApi.postMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(msg.type).toBe("switchToTextEditor");
        expect("line" in msg).toBe(false);
    });

    it("notifySwitchToTextEditor sends the line field when line is provided", () => {
        notifySwitchToTextEditor(42);
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "switchToTextEditor",
            line: 42,
        });
    });

    it("notifyUploadImage carries all required fields", () => {
        const data = new Uint8Array([1, 2, 3]);
        notifyUploadImage("req-001", data, "image/png", "photo");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "uploadImage",
            id: "req-001",
            data,
            mimeType: "image/png",
            altText: "photo",
        });
    });

    it("notifyGetProjectImages carries the id field", () => {
        notifyGetProjectImages("img-list-1");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "getProjectImages",
            id: "img-list-1",
        });
    });

    it("notifyGetPathSuggestions carries id and query", () => {
        notifyGetPathSuggestions("path-req-1", "./docs/");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "getPathSuggestions",
            id: "path-req-1",
            query: "./docs/",
        });
    });

    it("notifyResolveImagePath carries id and relPath", () => {
        notifyResolveImagePath("resolve-1", "./images/photo.png");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "resolveImagePath",
            id: "resolve-1",
            relPath: "./images/photo.png",
        });
    });

    it("notifyRenameImage carries id / webviewUri / newBasename", () => {
        notifyRenameImage("rename-1", "vscode-resource://img.png", "new-name.png");
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({
            type: "renameImage",
            id: "rename-1",
            webviewUri: "vscode-resource://img.png",
            newBasename: "new-name.png",
        });
    });

    it("notifyOpenSettings sends { type: 'openSettings' }", () => {
        notifyOpenSettings();
        expect(mockVscodeApi.postMessage).toHaveBeenCalledWith({ type: "openSettings" });
    });
});
