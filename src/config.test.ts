import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnvInt, parsePortRange } from "./config.js";

describe("parseEnvInt", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return default value when env var is undefined", () => {
    expect(parseEnvInt(undefined, 42)).toBe(42);
  });

  it("should return default value when env var is empty string", () => {
    expect(parseEnvInt("", 42)).toBe(42);
  });

  it("should parse valid integer", () => {
    expect(parseEnvInt("100", 42)).toBe(100);
  });

  it("should return default and warn for NaN input", () => {
    expect(parseEnvInt("abc", 42)).toBe(42);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid config value "abc"')
    );
  });

  it("should return default and warn for value below minimum", () => {
    expect(parseEnvInt("0", 42)).toBe(42);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid config value "0"'));
  });

  it("should return default and warn for negative value", () => {
    expect(parseEnvInt("-5", 42)).toBe(42);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid config value "-5"'));
  });

  it("should respect custom minimum value", () => {
    // min=0 allows zero
    expect(parseEnvInt("0", 42, 0)).toBe(0);
  });

  it("should reject value below custom minimum", () => {
    expect(parseEnvInt("-1", 42, 0)).toBe(42);
    expect(console.warn).toHaveBeenCalled();
  });

  it("should parse large valid integer", () => {
    expect(parseEnvInt("1000000", 42)).toBe(1000000);
  });

  it("should handle float-like string by parsing integer part", () => {
    // parseInt("3.14", 10) returns 3
    expect(parseEnvInt("3.14", 42)).toBe(3);
  });
});

describe("parsePortRange", () => {
  const defaultRange = { start: 1099, end: 1200 };

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return default range when env var is undefined", () => {
    expect(parsePortRange(undefined, defaultRange)).toEqual(defaultRange);
  });

  it("should return default range when env var is empty string", () => {
    expect(parsePortRange("", defaultRange)).toEqual(defaultRange);
  });

  it("should parse valid port range", () => {
    expect(parsePortRange("2000-3000", defaultRange)).toEqual({ start: 2000, end: 3000 });
  });

  it("should return default and warn when start > end", () => {
    expect(parsePortRange("3000-2000", defaultRange)).toEqual(defaultRange);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid port range "3000-2000"')
    );
  });

  it("should return default and warn for port above 65535", () => {
    expect(parsePortRange("1000-70000", defaultRange)).toEqual(defaultRange);
    expect(console.warn).toHaveBeenCalled();
  });

  it("should return default and warn for port 0", () => {
    expect(parsePortRange("0-100", defaultRange)).toEqual(defaultRange);
    expect(console.warn).toHaveBeenCalled();
  });

  it("should return default and warn for invalid format", () => {
    expect(parsePortRange("not-a-range", defaultRange)).toEqual(defaultRange);
    expect(console.warn).toHaveBeenCalled();
  });

  it("should return default and warn for single port number", () => {
    expect(parsePortRange("8080", defaultRange)).toEqual(defaultRange);
    expect(console.warn).toHaveBeenCalled();
  });

  it("should return default and warn for format with spaces", () => {
    expect(parsePortRange("1000 - 2000", defaultRange)).toEqual(defaultRange);
    expect(console.warn).toHaveBeenCalled();
  });

  it("should accept same start and end port", () => {
    expect(parsePortRange("8080-8080", defaultRange)).toEqual({ start: 8080, end: 8080 });
  });

  it("should accept boundary port values", () => {
    expect(parsePortRange("1-65535", defaultRange)).toEqual({ start: 1, end: 65535 });
  });
});

describe("defaultConfig and connectionConfig", () => {
  it("should have valid default config values", async () => {
    // Re-import to get fresh module state
    const { defaultConfig } = await import("./config.js");

    expect(defaultConfig.maxHandoffs).toBeGreaterThan(0);
    expect(defaultConfig.maxConversationBytes).toBeGreaterThan(0);
    expect(defaultConfig.maxSummaryBytes).toBeGreaterThan(0);
    expect(defaultConfig.maxTitleLength).toBeGreaterThan(0);
    expect(defaultConfig.maxKeyLength).toBeGreaterThan(0);
    expect(defaultConfig.keyPattern).toBeInstanceOf(RegExp);
  });

  it("should have valid connection config values", async () => {
    const { connectionConfig } = await import("./config.js");

    expect(connectionConfig.portRange.start).toBeGreaterThan(0);
    expect(connectionConfig.portRange.end).toBeGreaterThanOrEqual(connectionConfig.portRange.start);
    expect(connectionConfig.retryCount).toBeGreaterThan(0);
    expect(connectionConfig.retryIntervalMs).toBeGreaterThan(0);
    expect(connectionConfig.serverTtlMs).toBeGreaterThanOrEqual(0);
    expect(connectionConfig.fetchTimeoutMs).toBeGreaterThan(0);
  });
});
