import { describe, it, expect } from "vitest";
import { getNonce } from "../../src/utils/getNonce";

describe("getNonce", () => {
    it("returns a string", () => {
        expect(typeof getNonce()).toBe("string");
    });

    it("returns a 16-byte base64-encoded value (length 24)", () => {
        // A 16-byte base64-encoded value is fixed at 24 characters (including the = padding)
        expect(getNonce()).toHaveLength(24);
    });

    it("contains only legal base64 characters", () => {
        const nonce = getNonce();
        expect(nonce).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it("generates a different nonce on consecutive calls (uniqueness)", () => {
        const n1 = getNonce();
        const n2 = getNonce();
        // Randomness guarantees an extremely low collision rate; a collision means the randomness is broken
        expect(n1).not.toBe(n2);
    });

    it("generates 100 nonces in a batch, all unique", () => {
        const nonces = new Set(Array.from({ length: 100 }, () => getNonce()));
        expect(nonces.size).toBe(100);
    });
});
