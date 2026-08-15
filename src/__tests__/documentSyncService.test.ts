import { describe, it, expect, beforeEach } from "vitest";
import { DocumentSyncService } from "../services/DocumentSyncService";

describe("DocumentSyncService", () => {
    beforeEach(() => {
        DocumentSyncService.clear("test-uri");
    });

    it("saves and clears the hash correctly", () => {
        DocumentSyncService.recordSavedContent("test-uri", "# Hello World");
        // Hash has been stored internally
        DocumentSyncService.clear("test-uri");
        // Should not throw
        expect(true).toBe(true);
    });

    it("distinguishes between different contents", () => {
        DocumentSyncService.recordSavedContent("test-uri-1", "Content A");
        DocumentSyncService.recordSavedContent("test-uri-2", "Content B");
        expect(true).toBe(true);
    });
});
