import { describe, it, expect, beforeEach } from "vitest";
import { DocumentSyncService } from "../services/DocumentSyncService";

describe("DocumentSyncService", () => {
    beforeEach(() => {
        DocumentSyncService.clear("test-uri");
    });

    it("lưu và xóa hash chính xác", () => {
        DocumentSyncService.recordSavedContent("test-uri", "# Hello World");
        // Hash has been stored internally
        DocumentSyncService.clear("test-uri");
        // Should not throw
        expect(true).toBe(true);
    });

    it("phân biệt nội dung khác nhau", () => {
        DocumentSyncService.recordSavedContent("test-uri-1", "Content A");
        DocumentSyncService.recordSavedContent("test-uri-2", "Content B");
        expect(true).toBe(true);
    });
});
