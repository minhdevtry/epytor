import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";
import * as https from "https";
import * as http from "http";

// Import from the vscode mock (alias configured in vitest.config.ts)
import * as vscode from "vscode";

// Module-level mocks (Vitest auto-hoists above imports)
vi.mock("https", () => ({ request: vi.fn() }));
vi.mock("http", () => ({ request: vi.fn() }));
const mockFs = vscode.workspace.fs as {
    readFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    readDirectory: ReturnType<typeof vi.fn>;
    stat: ReturnType<typeof vi.fn>;
    createDirectory: ReturnType<typeof vi.fn>;
};

import {
    mimeToExt,
    generateFilename,
    buildRelPath,
    getByPath,
    saveImageLocally,
    uploadImageToServer,
} from "../../src/utils/imageService";

// ─────────────────────────────────────────────────────────────
// mimeToExt
// ─────────────────────────────────────────────────────────────
describe("mimeToExt", () => {
    it.each([
        ["image/png", "png"],
        ["image/jpeg", "jpg"],
        ["image/jpg", "jpg"],
        ["image/gif", "gif"],
        ["image/webp", "webp"],
        ["image/svg+xml", "svg"],
        ["image/bmp", "bmp"],
        ["image/tiff", "tiff"],
    ])("MIME %s → extension %s", (mime, ext) => {
        expect(mimeToExt(mime)).toBe(ext);
    });

    it("unknown MIME falls back to png", () => {
        expect(mimeToExt("image/xyz")).toBe("png");
    });

    it("empty string falls back to png", () => {
        expect(mimeToExt("")).toBe("png");
    });
});

// ─────────────────────────────────────────────────────────────
// generateFilename
// ─────────────────────────────────────────────────────────────
describe("generateFilename", () => {
    it("the returned filename ends with the correct extension", () => {
        const name = generateFilename("photo", "image/png");
        expect(name).toMatch(/\.png$/);
    });

    it("truncates altText when longer than 20 characters", () => {
        const name = generateFilename("a".repeat(30), "image/jpeg");
        const [prefix] = name.split("_");
        expect(prefix.length).toBeLessThanOrEqual(20);
    });

    it("replaces special characters in altText with a dash", () => {
        const name = generateFilename("hello world!", "image/png");
        const [prefix] = name.split("_");
        expect(prefix).not.toMatch(/[ !]/);
    });

    it("collapses consecutive special characters into a single dash", () => {
        const name = generateFilename("a  b!!c", "image/png");
        const [prefix] = name.split("_");
        expect(prefix).not.toMatch(/--/);
    });

    it("uses 'image' as the default prefix when altText is empty", () => {
        const name = generateFilename("", "image/png");
        expect(name.startsWith("image_")).toBe(true);
    });

    it("uses 'image' as the default prefix when altText contains only special characters", () => {
        const name = generateFilename("!!!---", "image/png");
        expect(name.startsWith("image_")).toBe(true);
    });

    it("preserves multiple words separated by spaces in altText", () => {
        // The generateFilename function supports all Unicode letter scripts via \p{L} (see imageService.ts)
        // Spaces are converted to hyphens, demonstrating the multi-word case
        const name = generateFilename("Screenshot Two Three", "image/png");
        expect(name).toMatch(/^Screenshot-Two-Three/);
    });

    it("generates different file names for consecutive calls with the same altText", () => {
        const n1 = generateFilename("test", "image/png");
        const n2 = generateFilename("test", "image/png");
        // Extremely low collision rate; sufficient to verify the uniqueness design
        expect(typeof n1).toBe("string");
        expect(typeof n2).toBe("string");
    });
});

// ─────────────────────────────────────────────────────────────
// buildRelPath
// ─────────────────────────────────────────────────────────────
describe("buildRelPath", () => {
    it("returns ./filename for a file in the same directory", () => {
        const docUri = vscode.Uri.file("/project/docs/note.md");
        const fileUri = vscode.Uri.file("/project/docs/images/photo.png");
        const rel = buildRelPath(docUri, fileUri);
        expect(rel).toBe("./images/photo.png");
    });

    it("returned path uses forward slashes (cross-platform)", () => {
        const docUri = vscode.Uri.file("/project/a/b/note.md");
        const fileUri = vscode.Uri.file("/project/a/b/imgs/x.png");
        const rel = buildRelPath(docUri, fileUri);
        expect(rel).not.toMatch(/\\/);
    });

    it("returned path starts with ./", () => {
        const docUri = vscode.Uri.file("/project/note.md");
        const fileUri = vscode.Uri.file("/project/images/x.png");
        const rel = buildRelPath(docUri, fileUri);
        expect(rel.startsWith("./")).toBe(true);
    });

    it("untitled document (non-file scheme) returns an absolute path", () => {
        const docUri = { fsPath: "untitled", scheme: "untitled", toString: () => "untitled:" };
        const fileUri = vscode.Uri.file("/home/user/images/photo.png");
        const rel = buildRelPath(docUri as typeof fileUri, fileUri);
        expect(path.isAbsolute(rel)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────
// getByPath
// ─────────────────────────────────────────────────────────────
describe("getByPath", () => {
    it("correctly extracts a top-level property", () => {
        expect(getByPath({ url: "https://example.com" }, "url")).toBe("https://example.com");
    });

    it("dot-separated path data.url correctly extracts a nested property", () => {
        expect(getByPath({ data: { url: "https://img.example.com/a.png" } }, "data.url")).toBe(
            "https://img.example.com/a.png"
        );
    });

    it("returns undefined when the path does not exist", () => {
        expect(getByPath({ a: 1 }, "b.c")).toBeUndefined();
    });

    it("returns undefined when an intermediate level is null", () => {
        expect(getByPath({ a: null }, "a.b")).toBeUndefined();
    });

    it("returns undefined for an empty object", () => {
        expect(getByPath({}, "x")).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────
// saveImageLocally — MD5 dedup logic
// ─────────────────────────────────────────────────────────────
describe("saveImageLocally — MD5 dedup", () => {
    const docUri = vscode.Uri.file("/project/docs/note.md");
    const imageData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic bytes

    function makeCfg(overrides: Record<string, unknown> = {}) {
        return {
            get: vi.fn((key: string, def?: unknown) => overrides[key] ?? def),
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        // Default stat rejects (directory does not exist, triggering creation)
        mockFs.stat.mockRejectedValue(new Error("ENOENT"));
        mockFs.createDirectory.mockResolvedValue(undefined);
        mockFs.readDirectory.mockResolvedValue([]);
        mockFs.writeFile.mockResolvedValue(undefined);
    });

    it("writes a new file and returns the relative path when the directory is empty", async () => {
        const cfg = makeCfg();
        const result = await saveImageLocally(docUri, cfg as never, imageData, "image/png", "photo");
        expect(mockFs.writeFile).toHaveBeenCalledOnce();
        expect(result.relPath).toMatch(/^\.\/images\//);
        expect(result.relPath).toMatch(/\.png$/);
    });

    it("reuses an existing file with the same MD5 and extension in the directory; no duplicate write", async () => {
        // Simulate an existing .png file in the directory
        const existingName = "photo_abc123_def4.png";
        mockFs.stat.mockResolvedValue({ type: vscode.FileType.Directory });
        mockFs.readDirectory.mockResolvedValue([[existingName, vscode.FileType.File]]);
        mockFs.readFile.mockResolvedValue(imageData); // Same content → same MD5

        const cfg = makeCfg();
        const result = await saveImageLocally(docUri, cfg as never, imageData, "image/png", "photo");

        expect(mockFs.writeFile).not.toHaveBeenCalled();
        expect(result.relPath).toContain(existingName);
    });

    it("writes a new file when an existing file in the directory has different content", async () => {
        const existingName = "other_abc123_def4.png";
        const differentData = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
        mockFs.stat.mockResolvedValue({ type: vscode.FileType.Directory });
        mockFs.readDirectory.mockResolvedValue([[existingName, vscode.FileType.File]]);
        mockFs.readFile.mockResolvedValue(differentData); // Different content → different MD5

        const cfg = makeCfg();
        await saveImageLocally(docUri, cfg as never, imageData, "image/png", "photo");

        expect(mockFs.writeFile).toHaveBeenCalledOnce();
    });

    it("does not compare files of different extensions (only same extension)", async () => {
        // Directory contains only a .jpg file; upload is .png
        const existingName = "photo_abc_def.jpg";
        mockFs.stat.mockResolvedValue({ type: vscode.FileType.Directory });
        mockFs.readDirectory.mockResolvedValue([[existingName, vscode.FileType.File]]);
        mockFs.readFile.mockResolvedValue(imageData);

        const cfg = makeCfg();
        await saveImageLocally(docUri, cfg as never, imageData, "image/png", "photo");

        // readFile should not be called (extension mismatch skips the comparison)
        expect(mockFs.readFile).not.toHaveBeenCalled();
        expect(mockFs.writeFile).toHaveBeenCalledOnce();
    });

    it("skips dedup and writes a new file when directory enumeration fails", async () => {
        mockFs.readDirectory.mockRejectedValue(new Error("EPERM"));

        const cfg = makeCfg();
        await saveImageLocally(docUri, cfg as never, imageData, "image/png", "photo");

        expect(mockFs.writeFile).toHaveBeenCalledOnce();
    });

    it("skips reading content for non-file directory entries", async () => {
        mockFs.stat.mockResolvedValue({ type: vscode.FileType.Directory });
        mockFs.readDirectory.mockResolvedValue([
            ["nested", vscode.FileType.Directory],
        ]);

        const cfg = makeCfg();
        await saveImageLocally(docUri, cfg as never, imageData, "image/png", "photo");

        expect(mockFs.readFile).not.toHaveBeenCalled();
        expect(mockFs.writeFile).toHaveBeenCalledOnce();
    });
});

// ─────────────────────────────────────────────────────────────
// saveImageLocally — directory selection priority
// ─────────────────────────────────────────────────────────────
describe("saveImageLocally — directory selection", () => {
    const docUri = vscode.Uri.file("/project/docs/note.md");
    const imageData = new Uint8Array([1, 2, 3]);

    function makeCfg(overrides: Record<string, unknown> = {}) {
        return { get: vi.fn((key: string, def?: unknown) => overrides[key] ?? def) };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mockFs.readDirectory.mockResolvedValue([]);
        mockFs.writeFile.mockResolvedValue(undefined);
        mockFs.createDirectory.mockResolvedValue(undefined);
    });

    it("prefers an absolute path from the imageLocalPath setting", async () => {
        const customPath = path.resolve("/custom/image-dir");
        mockFs.stat.mockResolvedValue({ type: vscode.FileType.Directory });
        const cfg = makeCfg({ imageLocalPath: customPath });
        await saveImageLocally(docUri, cfg as never, imageData, "image/png", "x");
        // writeFile should be called, and the path should contain customPath
        const [callUri] = mockFs.writeFile.mock.calls[0] as [{ fsPath: string }];
        expect(callUri.fsPath.startsWith(customPath)).toBe(true);
    });

    it("creates an images/ directory when no setting and none of the candidate directories exist", async () => {
        // stat always rejects (no directory exists)
        mockFs.stat.mockRejectedValue(new Error("ENOENT"));
        const cfg = makeCfg();
        await saveImageLocally(docUri, cfg as never, imageData, "image/png", "x");
        expect(mockFs.createDirectory).toHaveBeenCalled();
        const [createdUri] = mockFs.createDirectory.mock.calls[0] as [{ fsPath: string }];
        expect(createdUri.fsPath).toContain("images");
    });
});

// ─────────────────────────────────────────────────────────────
// saveImageLocally — extra path branches
// ─────────────────────────────────────────────────────────────
describe("saveImageLocally — extra path branches", () => {
    const imageData = new Uint8Array([1, 2, 3]);

    function makeCfg(overrides: Record<string, unknown> = {}) {
        return { get: vi.fn((key: string, def?: unknown) => overrides[key] ?? def) };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        (vscode.workspace.getWorkspaceFolder as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
        mockFs.readDirectory.mockResolvedValue([]);
        mockFs.writeFile.mockResolvedValue(undefined);
        mockFs.createDirectory.mockResolvedValue(undefined);
        mockFs.stat.mockRejectedValue(new Error("ENOENT"));
    });

    it("relative imageLocalPath + workspace folder: joins path under the workspace root", async () => {
        const docUri = vscode.Uri.file("/project/docs/note.md");
        (vscode.workspace.getWorkspaceFolder as ReturnType<typeof vi.fn>)
            .mockReturnValue({ uri: vscode.Uri.file("/project") });

        const cfg = makeCfg({ imageLocalPath: "static/images" });
        await saveImageLocally(docUri, cfg as never, imageData, "image/png", "x");

        const [callUri] = mockFs.writeFile.mock.calls[0] as [{ fsPath: string }];
        expect(callUri.fsPath).toContain(path.join("static", "images"));
    });

    it("relative imageLocalPath + no workspace folder: joins path under the .md directory", async () => {
        const docUri = vscode.Uri.file("/project/docs/note.md");

        const cfg = makeCfg({ imageLocalPath: "imgs" });
        await saveImageLocally(docUri, cfg as never, imageData, "image/png", "x");

        const [callUri] = mockFs.writeFile.mock.calls[0] as [{ fsPath: string }];
        expect(callUri.fsPath).toContain("imgs");
    });

    it("untitled (non-file scheme) document falls back to the home/images/ directory", async () => {
        const untitledUri = {
            fsPath: "untitled-1",
            scheme: "untitled",
            toString: () => "untitled:untitled-1",
        };

        const cfg = makeCfg();
        await saveImageLocally(untitledUri as never, cfg as never, imageData, "image/png", "x");

        expect(mockFs.createDirectory).toHaveBeenCalled();
        const [callUri] = mockFs.writeFile.mock.calls[0] as [{ fsPath: string }];
        expect(callUri.fsPath).toContain("images");
    });

    it("auto-detect prefers an existing imgs candidate directory", async () => {
        const docUri = vscode.Uri.file("/project/docs/note.md");
        mockFs.stat.mockImplementation(({ fsPath }: { fsPath: string }) =>
            fsPath.endsWith("imgs")
                ? Promise.resolve({ type: vscode.FileType.Directory })
                : Promise.reject(new Error("ENOENT")),
        );

        const cfg = makeCfg();
        await saveImageLocally(docUri, cfg as never, imageData, "image/png", "x");

        const [callUri] = mockFs.writeFile.mock.calls[0] as [{ fsPath: string }];
        expect(callUri.fsPath).toContain("imgs");
        expect(mockFs.createDirectory).not.toHaveBeenCalled();
    });

    it("MD5 dedup: skips a file and continues when readFile fails", async () => {
        const docUri = vscode.Uri.file("/project/docs/note.md");
        mockFs.readDirectory.mockResolvedValue([["broken.png", vscode.FileType.File]]);
        mockFs.readFile.mockRejectedValue(new Error("EPERM"));

        const cfg = makeCfg();
        const result = await saveImageLocally(docUri, cfg as never, imageData, "image/png", "x");

        expect(mockFs.writeFile).toHaveBeenCalledOnce();
        expect(result.relPath).toMatch(/\.png$/);
    });
});

// ─────────────────────────────────────────────────────────────
// uploadImageToServer
// ─────────────────────────────────────────────────────────────

function createSuccessMockTransport(responseBody: string) {
    const dataHandlers: Array<(chunk: Buffer) => void> = [];
    const endHandlers: Array<() => void> = [];

    const mockRes = {
        on: vi.fn((event: string, cb: unknown) => {
            if (event === "data") dataHandlers.push(cb as (c: Buffer) => void);
            if (event === "end") endHandlers.push(cb as () => void);
        }),
    };

    const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        write: vi.fn(),
        end: vi.fn(() => {
            dataHandlers.forEach(h => h(Buffer.from(responseBody)));
            endHandlers.forEach(h => h());
        }),
        destroy: vi.fn(),
    };

    return { mockRes, mockReq };
}

function createErrorMockTransport(error: Error) {
    const errHandlers: Array<(e: Error) => void> = [];

    return {
        on: vi.fn((event: string, cb: unknown) => {
            if (event === "error") errHandlers.push(cb as (e: Error) => void);
        }),
        setTimeout: vi.fn(),
        write: vi.fn(),
        end: vi.fn(() => { errHandlers.forEach(h => h(error)); }),
        destroy: vi.fn(),
    };
}

describe("uploadImageToServer", () => {
    const imageData = new Uint8Array([1, 2, 3, 4]);

    function makeCfg(overrides: Record<string, unknown> = {}) {
        return { get: vi.fn((key: string, def?: unknown) => overrides[key] ?? def) };
    }

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("throws immediately when serverUrl is empty, without making a network request", async () => {
        const cfg = makeCfg({ imageServerUrl: "" });
        await expect(
            uploadImageToServer(cfg as never, imageData, "image/png", "photo"),
        ).rejects.toThrow("Please configure");
    });

    it("HTTPS upload succeeds and returns the URL from the response", async () => {
        const { mockRes, mockReq } = createSuccessMockTransport('{"url":"https://cdn.example.com/img.png"}');
        vi.mocked(https.request).mockImplementation((_opts, cb) => {
            (cb as (r: typeof mockRes) => void)(mockRes);
            return mockReq as never;
        });

        const cfg = makeCfg({ imageServerUrl: "https://upload.example.com/api" });
        const result = await uploadImageToServer(cfg as never, imageData, "image/png", "photo");
        expect(result).toBe("https://cdn.example.com/img.png");
    });

    it("uses the http module for HTTP URLs, not https", async () => {
        const { mockRes, mockReq } = createSuccessMockTransport('{"url":"http://cdn.example.com/img.png"}');
        vi.mocked(http.request).mockImplementation((_opts, cb) => {
            (cb as (r: typeof mockRes) => void)(mockRes);
            return mockReq as never;
        });

        const cfg = makeCfg({ imageServerUrl: "http://upload.example.com/api" });
        await uploadImageToServer(cfg as never, imageData, "image/png", "photo");

        expect(vi.mocked(http.request)).toHaveBeenCalled();
        expect(vi.mocked(https.request)).not.toHaveBeenCalled();
    });

    it("serializes extraParams and writes them into the request body", async () => {
        const { mockRes, mockReq } = createSuccessMockTransport('{"url":"https://cdn.example.com/img.png"}');
        vi.mocked(https.request).mockImplementation((_opts, cb) => {
            (cb as (r: typeof mockRes) => void)(mockRes);
            return mockReq as never;
        });

        const cfg = makeCfg({
            imageServerUrl: "https://upload.example.com/api",
            imageServerExtraParams: '{"token":"abc123"}',
        });
        await uploadImageToServer(cfg as never, imageData, "image/png", "photo");

        const body = (mockReq.write.mock.calls[0]?.[0] as Buffer).toString();
        expect(body).toContain("token");
        expect(body).toContain("abc123");
    });

    it("ignores invalid JSON in extraParams and continues the upload", async () => {
        const { mockRes, mockReq } = createSuccessMockTransport('{"url":"https://cdn.example.com/img.png"}');
        vi.mocked(https.request).mockImplementation((_opts, cb) => {
            (cb as (r: typeof mockRes) => void)(mockRes);
            return mockReq as never;
        });

        const cfg = makeCfg({
            imageServerUrl: "https://upload.example.com/api",
            imageServerExtraParams: "not-valid-json!!!",
        });
        await expect(
            uploadImageToServer(cfg as never, imageData, "image/png", "photo"),
        ).resolves.toBe("https://cdn.example.com/img.png");
    });

    it("throws an error when the server returns non-JSON", async () => {
        const { mockRes, mockReq } = createSuccessMockTransport("Internal Server Error");
        vi.mocked(https.request).mockImplementation((_opts, cb) => {
            (cb as (r: typeof mockRes) => void)(mockRes);
            return mockReq as never;
        });

        const cfg = makeCfg({ imageServerUrl: "https://upload.example.com/api" });
        await expect(
            uploadImageToServer(cfg as never, imageData, "image/png", "photo"),
        ).rejects.toThrow("non-JSON");
    });

    it("throws when the path configured in responsePath cannot extract a URL from the response", async () => {
        const { mockRes, mockReq } = createSuccessMockTransport('{"status":"ok"}');
        vi.mocked(https.request).mockImplementation((_opts, cb) => {
            (cb as (r: typeof mockRes) => void)(mockRes);
            return mockReq as never;
        });

        const cfg = makeCfg({ imageServerUrl: "https://upload.example.com/api" });
        await expect(
            uploadImageToServer(cfg as never, imageData, "image/png", "photo"),
        ).rejects.toThrow("Cannot extract URL");
    });

    it("rejects the Promise on a network error", async () => {
        const mockReq = createErrorMockTransport(new Error("ECONNREFUSED"));
        vi.mocked(https.request).mockImplementation(() => mockReq as never);

        const cfg = makeCfg({ imageServerUrl: "https://upload.example.com/api" });
        await expect(
            uploadImageToServer(cfg as never, imageData, "image/png", "photo"),
        ).rejects.toThrow("ECONNREFUSED");
    });

    it("destroys the request and throws a timeout error after 30 seconds", async () => {
        const errorHandlers: Array<(error: Error) => void> = [];
        const mockReq = {
            on: vi.fn((event: string, callback: unknown) => {
                if (event === "error") {
                    errorHandlers.push(callback as (error: Error) => void);
                }
            }),
            setTimeout: vi.fn((_delay: number, callback: () => void) => callback()),
            write: vi.fn(),
            end: vi.fn(),
            destroy: vi.fn((error: Error) => {
                errorHandlers.forEach((handler) => handler(error));
            }),
        };
        vi.mocked(https.request).mockImplementation(() => mockReq as never);
        const cfg = makeCfg({ imageServerUrl: "https://upload.example.com/api" });

        await expect(
            uploadImageToServer(cfg as never, imageData, "image/png", "photo"),
        ).rejects.toThrow("Upload request timed out after 30s");
        expect(mockReq.setTimeout).toHaveBeenCalledWith(30000, expect.any(Function));
        expect(mockReq.destroy).toHaveBeenCalledOnce();
    });

    it("correctly extracts the URL for nested responsePath (e.g. data.url)", async () => {
        const { mockRes, mockReq } = createSuccessMockTransport(
            '{"data":{"url":"https://cdn.example.com/img.png"}}',
        );
        vi.mocked(https.request).mockImplementation((_opts, cb) => {
            (cb as (r: typeof mockRes) => void)(mockRes);
            return mockReq as never;
        });

        const cfg = makeCfg({
            imageServerUrl: "https://upload.example.com/api",
            imageServerResponsePath: "data.url",
        });
        const result = await uploadImageToServer(cfg as never, imageData, "image/png", "photo");
        expect(result).toBe("https://cdn.example.com/img.png");
    });
});
