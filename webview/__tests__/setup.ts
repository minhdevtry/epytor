/**
 * jsdom environment setup: inject the global `acquireVsCodeApi` function before test files load,
 * so that messaging.ts can call it normally during module initialization.
 */
import { vi } from "vitest";

const mockVscodeApi = {
    postMessage: vi.fn(),
    getState: vi.fn(() => null),
    setState: vi.fn(),
};

Object.defineProperty(globalThis, "acquireVsCodeApi", {
    value: () => mockVscodeApi,
    writable: true,
    configurable: true,
});

/** Exposed for use in test assertions */
export { mockVscodeApi };
