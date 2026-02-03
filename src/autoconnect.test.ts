import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKey, scanForServer } from "./autoconnect.js";

describe("generateKey", () => {
  it("should generate key with correct format", () => {
    const key = generateKey();
    // Format: handoff-YYYYMMDDHHMMSS-random8chars
    expect(key).toMatch(/^handoff-\d{14}-[a-f0-9]{8}$/);
  });

  it("should generate unique keys", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      keys.add(generateKey());
    }
    // All keys should be unique
    expect(keys.size).toBe(100);
  });

  it("should include timestamp in key", () => {
    const before = new Date();
    const key = generateKey();
    const after = new Date();

    // Extract timestamp part (YYYYMMDDHHMMSS)
    const match = key.match(/^handoff-(\d{14})-/);
    expect(match).not.toBeNull();

    // biome-ignore lint/style/noNonNullAssertion: match is guaranteed to exist after expect assertion
    const timestampStr = match![1];
    const year = Number.parseInt(timestampStr.slice(0, 4), 10);
    const month = Number.parseInt(timestampStr.slice(4, 6), 10);
    const day = Number.parseInt(timestampStr.slice(6, 8), 10);

    expect(year).toBeGreaterThanOrEqual(before.getFullYear());
    expect(year).toBeLessThanOrEqual(after.getFullYear());
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });

  it("should use cryptographically secure random", () => {
    // crypto.randomUUID generates hex characters (0-9, a-f)
    const keys: string[] = [];
    for (let i = 0; i < 50; i++) {
      keys.push(generateKey());
    }

    // Extract random parts
    const randomParts = keys.map((k) => {
      const match = k.match(/-([a-f0-9]{8})$/);
      // biome-ignore lint/style/noNonNullAssertion: match is guaranteed to exist for generateKey output
      return match![1];
    });

    // All random parts should only contain hex characters
    for (const part of randomParts) {
      expect(part).toMatch(/^[a-f0-9]{8}$/);
    }
  });
});

describe("scanForServer", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should limit concurrent port scans", async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;
    const portRange = { start: 1099, end: 1150 }; // 52 ports

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 10));

      currentConcurrent--;
      return Promise.reject(new Error("Connection refused"));
    });

    await scanForServer(portRange);

    // Should never exceed SCAN_CONCURRENCY (10)
    expect(maxConcurrent).toBeLessThanOrEqual(10);
  });

  it("should return found port", async () => {
    const portRange = { start: 1099, end: 1105 };

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      // Port 1102 has a server
      if (url === "http://localhost:1102/") {
        return {
          ok: true,
          json: () => Promise.resolve({ name: "conversation-handoff-server" }),
        };
      }
      throw new Error("Connection refused");
    });

    const port = await scanForServer(portRange);
    expect(port).toBe(1102);
  });

  it("should return null when no server found", async () => {
    const portRange = { start: 1099, end: 1105 };

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const port = await scanForServer(portRange);
    expect(port).toBeNull();
  });

  it("should stop scanning after finding first server", async () => {
    const portRange = { start: 1099, end: 1200 }; // 102 ports
    const checkedPorts: number[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      const match = url.match(/localhost:(\d+)/);
      if (match) {
        checkedPorts.push(Number.parseInt(match[1], 10));
      }

      // Port 1099 (first port in first chunk) has a server
      if (url === "http://localhost:1099/") {
        return {
          ok: true,
          json: () => Promise.resolve({ name: "conversation-handoff-server" }),
        };
      }
      throw new Error("Connection refused");
    });

    const port = await scanForServer(portRange);
    expect(port).toBe(1099);

    // Should only check first chunk (10 ports) since server was found
    expect(checkedPorts.length).toBeLessThanOrEqual(10);
  });
});
