import { describe, it, expect, vi, beforeEach } from "vitest";
import * as https from "https";
import * as vscode from "vscode";
import {
    hmacSha256,
    sha256Hex,
    getSignatureKey,
    uploadImageToR2,
} from "../utils/r2Service";
import { EventEmitter } from "events";

vi.mock("https", () => ({ request: vi.fn() }));

function createMockConfig(values: Record<string, unknown>): vscode.WorkspaceConfiguration {
    return {
        get: <T>(key: string, defaultValue?: T): T => {
            if (key in values) {
                return values[key] as T;
            }
            return defaultValue as T;
        },
        has: (key: string) => key in values,
        inspect: () => undefined,
        update: vi.fn(),
    };
}

describe("r2Service cryptographic helpers", () => {
    it("sha256Hex 应正确计算字符串与 Buffer 的 SHA-256 哈希值", () => {
        expect(sha256Hex("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
        expect(sha256Hex(Buffer.from("hello"))).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    });

    it("hmacSha256 应正确生成 HMAC-SHA256 Buffer", () => {
        const hmac = hmacSha256("key", "data");
        expect(hmac).toBeInstanceOf(Buffer);
        expect(hmac.toString("hex")).toBe("5031fe3d989c6d1537a013fa6e739da23463fdaec3b70137d828e36ace221bd0");
    });

    it("getSignatureKey 应按 AWS SigV4 规范派生密钥", () => {
        const key = getSignatureKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20130524", "us-east-1", "s3");
        expect(key).toBeInstanceOf(Buffer);
        expect(key.length).toBe(32);
    });
});

describe("uploadImageToR2", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("缺少必填配置时 应抛出明确的错误信息", async () => {
        const cfg = createMockConfig({
            "r2.accountId": "",
            "r2.accessKeyId": "",
            "r2.secretAccessKey": "",
            "r2.bucket": "",
        });

        await expect(uploadImageToR2(cfg, new Uint8Array([1, 2, 3]), "image/png", "test")).rejects.toThrow(
            /Missing Cloudflare R2 configuration/,
        );
    });

    it("正确配置并在 R2 返回 200 时 应成功上传并返回 publicDomain URL", async () => {
        const cfg = createMockConfig({
            "r2.accountId": "acc123",
            "r2.accessKeyId": "key123",
            "r2.secretAccessKey": "sec123",
            "r2.bucket": "my-bucket",
            "r2.publicDomain": "https://cdn.example.com",
            "r2.pathPrefix": "images/",
        });

        const mockReq = new EventEmitter() as any;
        mockReq.write = vi.fn();
        mockReq.end = vi.fn();
        mockReq.destroy = vi.fn();

        (https.request as any).mockImplementation((opts: any, callback: (res: any) => void) => {
            expect(opts.hostname).toBe("acc123.r2.cloudflarestorage.com");
            expect(opts.method).toBe("PUT");
            expect(opts.path).toMatch(/^\/my-bucket\/images\/test_/);
            expect(opts.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=key123\//);
            expect(opts.headers["x-amz-content-sha256"]).toBeDefined();

            const mockRes = new EventEmitter() as any;
            mockRes.statusCode = 200;

            process.nextTick(() => {
                callback(mockRes);
                mockRes.emit("data", "");
                mockRes.emit("end");
            });

            return mockReq;
        });

        const url = await uploadImageToR2(cfg, new Uint8Array([1, 2, 3]), "image/png", "test");
        expect(url).toMatch(/^https:\/\/cdn\.example\.com\/images\/test_/);
        expect(url).toMatch(/\.png$/);
        expect(mockReq.write).toHaveBeenCalled();
        expect(mockReq.end).toHaveBeenCalled();
    });

    it("当未配置 publicDomain 时 应回退到 r2.cloudflarestorage.com 默认 URL", async () => {
        const cfg = createMockConfig({
            "r2.accountId": "acc123",
            "r2.accessKeyId": "key123",
            "r2.secretAccessKey": "sec123",
            "r2.bucket": "my-bucket",
            "r2.publicDomain": "",
            "r2.pathPrefix": "/custom/nested/",
        });

        const mockReq = new EventEmitter() as any;
        mockReq.write = vi.fn();
        mockReq.end = vi.fn();

        (https.request as any).mockImplementation((opts: any, callback: (res: any) => void) => {
            const mockRes = new EventEmitter() as any;
            mockRes.statusCode = 204;
            process.nextTick(() => {
                callback(mockRes);
                mockRes.emit("end");
            });
            return mockReq;
        });

        const url = await uploadImageToR2(cfg, new Uint8Array([1, 2, 3]), "image/jpeg", "avatar");
        expect(url).toMatch(/^https:\/\/my-bucket\.acc123\.r2\.cloudflarestorage\.com\/custom\/nested\/avatar_/);
        expect(url).toMatch(/\.jpg$/);
    });

    it("当服务器返回 HTTP 403 时 应抛出详细错误", async () => {
        const cfg = createMockConfig({
            "r2.accountId": "acc123",
            "r2.accessKeyId": "key123",
            "r2.secretAccessKey": "sec123",
            "r2.bucket": "my-bucket",
        });

        const mockReq = new EventEmitter() as any;
        mockReq.write = vi.fn();
        mockReq.end = vi.fn();

        (https.request as any).mockImplementation((opts: any, callback: (res: any) => void) => {
            const mockRes = new EventEmitter() as any;
            mockRes.statusCode = 403;
            process.nextTick(() => {
                callback(mockRes);
                mockRes.emit("data", "Access Denied");
                mockRes.emit("end");
            });
            return mockReq;
        });

        await expect(uploadImageToR2(cfg, new Uint8Array([1, 2, 3]), "image/png", "test")).rejects.toThrow(
            /R2 Upload failed HTTP 403: Access Denied/,
        );
    });

    it("当网络请求出现错误时 应抛出 Network Error", async () => {
        const cfg = createMockConfig({
            "r2.accountId": "acc123",
            "r2.accessKeyId": "key123",
            "r2.secretAccessKey": "sec123",
            "r2.bucket": "my-bucket",
        });

        const mockReq = new EventEmitter() as any;
        mockReq.write = vi.fn();
        mockReq.end = vi.fn();

        (https.request as any).mockImplementation(() => {
            process.nextTick(() => {
                mockReq.emit("error", new Error("ENOTFOUND"));
            });
            return mockReq;
        });

        await expect(uploadImageToR2(cfg, new Uint8Array([1, 2, 3]), "image/png", "test")).rejects.toThrow(
            /R2 Network Error: ENOTFOUND/,
        );
    });
});
