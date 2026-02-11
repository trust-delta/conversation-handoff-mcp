import { readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLogger, getAuditLogger, initAudit, resetAudit } from "./audit.js";

function makeTmpDir(): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return join(tmpdir(), `audit-test-${suffix}`);
}

async function readJsonlLines(filePath: string): Promise<Record<string, unknown>[]> {
  const content = await readFile(filePath, "utf-8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function requireFilePath(logger: AuditLogger): string {
  const fp = logger.getFilePath();
  if (!fp) throw new Error("Expected file path to be set");
  return fp;
}

describe("AuditLogger (enabled)", () => {
  let logger: AuditLogger;
  let auditDir: string;

  beforeEach(async () => {
    auditDir = makeTmpDir();
    logger = new AuditLogger(true, auditDir);
    await logger.init();
  });

  afterEach(async () => {
    await logger.shutdown();
    await rm(auditDir, { recursive: true, force: true });
  });

  it("init() でディレクトリとファイルが作成される", async () => {
    const files = await readdir(auditDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^audit-\d{14}-[a-f0-9]{8}\.jsonl$/);
  });

  it("isEnabled() が true を返す", () => {
    expect(logger.isEnabled()).toBe(true);
  });

  it("getSessionId() が8文字のhex文字列を返す", () => {
    expect(logger.getSessionId()).toMatch(/^[a-f0-9]{8}$/);
  });

  it("getFilePath() がファイルパスを返す", () => {
    const fp = requireFilePath(logger);
    expect(fp).toContain(auditDir);
    expect(fp).toMatch(/\.jsonl$/);
  });

  it("logLifecycle() がJSONL行を書き込む", async () => {
    logger.logLifecycle({ event: "startup", mode: "stdio" });
    await logger.shutdown();

    const lines = await readJsonlLines(requireFilePath(logger));
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const entry = lines[0];
    expect(entry.category).toBe("lifecycle");
    expect(entry.event).toBe("startup");
    expect(entry.mode).toBe("stdio");
    expect(entry.timestamp).toBeDefined();
    expect(entry.sessionId).toBe(logger.getSessionId());
  });

  it("logTool() がJSONL行を書き込む", async () => {
    logger.logTool({
      event: "tool_call",
      toolName: "handoff_save",
      durationMs: 42,
      success: true,
    });
    await logger.shutdown();

    const lines = await readJsonlLines(requireFilePath(logger));
    const entry = lines[0];
    expect(entry.category).toBe("tool");
    expect(entry.toolName).toBe("handoff_save");
    expect(entry.durationMs).toBe(42);
    expect(entry.success).toBe(true);
  });

  it("logStorage() がJSONL行を書き込む", async () => {
    logger.logStorage({
      event: "save",
      key: "test-key",
      dataSize: 1024,
      success: true,
    });
    await logger.shutdown();

    const lines = await readJsonlLines(requireFilePath(logger));
    const entry = lines[0];
    expect(entry.category).toBe("storage");
    expect(entry.event).toBe("save");
    expect(entry.key).toBe("test-key");
  });

  it("logConnection() がJSONL行を書き込む", async () => {
    logger.logConnection({ event: "scan_start", portCount: 5 });
    await logger.shutdown();

    const lines = await readJsonlLines(requireFilePath(logger));
    const entry = lines[0];
    expect(entry.category).toBe("connection");
    expect(entry.event).toBe("scan_start");
    expect(entry.portCount).toBe(5);
  });

  it("logHttp() がJSONL行を書き込む", async () => {
    logger.logHttp({
      event: "request",
      method: "POST",
      path: "/save",
      statusCode: 200,
      durationMs: 15,
    });
    await logger.shutdown();

    const lines = await readJsonlLines(requireFilePath(logger));
    const entry = lines[0];
    expect(entry.category).toBe("http");
    expect(entry.method).toBe("POST");
    expect(entry.statusCode).toBe(200);
  });

  it("logValidation() がJSONL行を書き込む", async () => {
    logger.logValidation({
      event: "validation_failure",
      field: "key",
      error: "invalid",
    });
    await logger.shutdown();

    const lines = await readJsonlLines(requireFilePath(logger));
    const entry = lines[0];
    expect(entry.category).toBe("validation");
    expect(entry.event).toBe("validation_failure");
    expect(entry.field).toBe("key");
  });

  it("logPerformance() がJSONL行を書き込む", async () => {
    logger.logPerformance({
      event: "snapshot",
      memoryUsageMB: 50.1,
      activeHandoffs: 3,
      uptimeSeconds: 120,
    });
    await logger.shutdown();

    const lines = await readJsonlLines(requireFilePath(logger));
    const entry = lines[0];
    expect(entry.category).toBe("performance");
    expect(entry.memoryUsageMB).toBe(50.1);
    expect(entry.activeHandoffs).toBe(3);
  });

  it("各エントリに timestamp, sessionId, category, event が含まれる", async () => {
    logger.logLifecycle({ event: "startup" });
    logger.logTool({
      event: "tool_call",
      toolName: "test",
      durationMs: 1,
      success: true,
    });
    logger.logStorage({ event: "list", success: true });
    await logger.shutdown();

    const lines = await readJsonlLines(requireFilePath(logger));
    for (const entry of lines) {
      expect(entry.timestamp).toBeDefined();
      expect(typeof entry.timestamp).toBe("string");
      expect(entry.sessionId).toBe(logger.getSessionId());
      expect(entry.category).toBeDefined();
      expect(entry.event).toBeDefined();
    }
  });

  it("startTimer() が実際の経過時間を返す", async () => {
    const timer = logger.startTimer();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const elapsed = timer.elapsed();
    expect(elapsed).toBeGreaterThanOrEqual(30);
    expect(elapsed).toBeLessThan(500);
  });

  it("setActiveHandoffsGetter() でgetterが登録される", async () => {
    logger.setActiveHandoffsGetter(() => 7);
    // getter が機能するかはperformance snapshotで間接検証
    // ここでは例外なく呼べることを確認
    expect(() => logger.setActiveHandoffsGetter(() => 0)).not.toThrow();
  });
});

describe("AuditLogger (disabled)", () => {
  let logger: AuditLogger;
  let auditDir: string;

  beforeEach(() => {
    auditDir = makeTmpDir();
    logger = new AuditLogger(false, auditDir);
  });

  afterEach(async () => {
    await logger.shutdown();
    await rm(auditDir, { recursive: true, force: true }).catch(() => {});
  });

  it("init() でディレクトリが作成されない", async () => {
    await logger.init();
    const exists = await readdir(auditDir).catch(() => null);
    expect(exists).toBeNull();
  });

  it("log*() メソッドが何もしない", async () => {
    await logger.init();
    logger.logLifecycle({ event: "startup" });
    logger.logTool({
      event: "tool_call",
      toolName: "t",
      durationMs: 0,
      success: true,
    });
    logger.logStorage({ event: "save", success: true });
    logger.logConnection({ event: "scan_start" });
    logger.logHttp({
      event: "request",
      method: "GET",
      path: "/",
      statusCode: 200,
      durationMs: 0,
    });
    logger.logValidation({ event: "truncation", field: "x" });
    logger.logPerformance({
      event: "snapshot",
      memoryUsageMB: 0,
      activeHandoffs: 0,
      uptimeSeconds: 0,
    });

    // ディレクトリが作成されていないので、ファイルも存在しない
    expect(logger.getFilePath()).toBeNull();
  });

  it("startTimer() が常に0を返す", async () => {
    const timer = logger.startTimer();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(timer.elapsed()).toBe(0);
  });

  it("isEnabled() が false を返す", () => {
    expect(logger.isEnabled()).toBe(false);
  });
});

describe("ファイルローテーション", () => {
  let logger: AuditLogger;
  let auditDir: string;

  beforeEach(async () => {
    auditDir = makeTmpDir();
    logger = new AuditLogger(true, auditDir);
    await logger.init();
  });

  afterEach(async () => {
    await rm(auditDir, { recursive: true, force: true });
  });

  it("10MBを超えるデータを書き込むとローテーションが発生する", async () => {
    // 大きなエントリ（約100KB）を使い、閾値を少しだけ超えるようにする
    // これにより concurrent rotation の回数を最小限に抑える
    const bigPayload = "x".repeat(99000);
    for (let i = 0; i < 108; i++) {
      logger.logStorage({
        event: "save",
        key: bigPayload,
        dataSize: i,
        success: true,
      });
    }

    await logger.shutdown();
    // rotate() は void で発火されるため、完了を待つ
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const files = await readdir(auditDir);
    const rotatedFiles = files.filter((f) => f.includes(".jsonl."));
    expect(rotatedFiles.length).toBeGreaterThanOrEqual(1);

    // .1 拡張子のファイルが存在する
    const dot1File = files.find((f) => f.endsWith(".jsonl.1"));
    expect(dot1File).toBeDefined();
  }, 10000);
});

describe("shutdown", () => {
  it("shutdown() で pending writes がフラッシュされる", async () => {
    const auditDir = makeTmpDir();
    const logger = new AuditLogger(true, auditDir);
    await logger.init();

    // 複数のエントリをキューに入れる
    for (let i = 0; i < 100; i++) {
      logger.logLifecycle({ event: "startup", version: `v${i}` });
    }

    // shutdown でフラッシュ
    await logger.shutdown();

    const lines = await readJsonlLines(requireFilePath(logger));
    expect(lines.length).toBe(100);

    await rm(auditDir, { recursive: true, force: true });
  });
});

describe("initAudit / getAuditLogger / resetAudit", () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = makeTmpDir();
    resetAudit();
  });

  afterEach(async () => {
    resetAudit();
    await rm(auditDir, { recursive: true, force: true }).catch(() => {});
  });

  it("initAudit() がロガーを初期化して返す", async () => {
    const logger = await initAudit(true, auditDir);
    expect(logger).toBeInstanceOf(AuditLogger);
    expect(logger.isEnabled()).toBe(true);
    expect(logger.getFilePath()).not.toBeNull();
    await logger.shutdown();
  });

  it("getAuditLogger() が initAudit 後に同じインスタンスを返す", async () => {
    const logger = await initAudit(true, auditDir);
    const retrieved = getAuditLogger();
    expect(retrieved).toBe(logger);
    await logger.shutdown();
  });

  it("getAuditLogger() が未初期化時にdisabledロガーを返す", () => {
    const logger = getAuditLogger();
    expect(logger).toBeInstanceOf(AuditLogger);
    expect(logger.isEnabled()).toBe(false);
  });

  it("resetAudit() がグローバルロガーをリセットする", async () => {
    const logger = await initAudit(true, auditDir);
    await logger.shutdown();

    resetAudit();

    const fallback = getAuditLogger();
    expect(fallback).not.toBe(logger);
    expect(fallback.isEnabled()).toBe(false);
  });

  it("initAudit(false) でdisabledロガーを作成する", async () => {
    const logger = await initAudit(false, auditDir);
    expect(logger.isEnabled()).toBe(false);
    expect(logger.getFilePath()).toBeNull();
    await logger.shutdown();
  });
});
