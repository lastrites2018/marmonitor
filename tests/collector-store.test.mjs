import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  readCollectorStatuslineForRequest,
  readCurrentCollectorStatusline,
  readHealthyCollectorSnapshot,
  readHealthyCollectorSnapshotForRequest,
  readHealthyCollectorStatusline,
} from "../dist/collector/client.js";
import {
  acquireCollectorRunLock,
  clearCollectorHealth,
  collectorHealthFile,
  collectorRunLockFile,
  collectorSnapshotFile,
  collectorStatuslineFile,
  refreshCollectorRunLock,
  readCollectorHealth,
  readCollectorSnapshot,
  readCollectorStatusline,
  releaseCollectorRunLock,
  writeCollectorHealth,
  writeCollectorSnapshot,
  writeCollectorStatusline,
} from "../dist/collector/store.js";
import { getDefaults } from "../dist/config/index.js";

describe("collector store", () => {
  it("writes and reads collector health", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-health-"));
    const now = Date.now();
    await writeCollectorHealth(
      {
        pid: 321,
        startedAt: now,
        lastTickAt: now,
        lastSuccessAt: now,
        snapshotGeneratedAt: now,
        state: "idle",
        version: "test",
        snapshotTtlMs: 2_000,
        statuslineTtlMs: 2_000,
        statuslineAttentionLimit: 5,
      },
      root,
    );

    await stat(collectorHealthFile(root));
    const health = await readCollectorHealth(10_000, root);
    assert.equal(health?.value.pid, 321);
    assert.equal(health?.fresh, true);
  });

  it("clears collector health when requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-health-clear-"));
    const now = Date.now();
    await writeCollectorHealth(
      {
        pid: 654,
        startedAt: now,
        lastTickAt: now,
        lastSuccessAt: now,
        snapshotGeneratedAt: now,
        state: "idle",
        version: "test",
      },
      root,
    );

    await clearCollectorHealth(root);
    const health = await readCollectorHealth(10_000, root);
    assert.equal(health, undefined);
  });

  it("writes and reads collector light snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-snapshot-"));
    await writeCollectorSnapshot(
      [
        {
          pid: 1,
          agentName: "Claude Code",
          cwd: "/repo",
          status: "Idle",
          runtimeSource: "cli",
        },
      ],
      root,
    );

    await stat(collectorSnapshotFile(root));
    const snapshot = await readCollectorSnapshot(10_000, root);
    assert.equal(snapshot?.value[0]?.pid, 1);
    assert.equal(snapshot?.fresh, true);
  });

  it("writes and reads collector statusline text", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-statusline-"));
    await writeCollectorStatusline("compact", 5, undefined, "AI14 | 20%", root);

    await stat(collectorStatuslineFile("compact", 5, undefined, root));
    const statusline = await readCollectorStatusline("compact", 5, undefined, 10_000, root);
    assert.equal(statusline?.value, "AI14 | 20%");
    assert.equal(statusline?.fresh, true);
  });

  it("acquires and releases a collector run lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-lock-"));
    const acquired = await acquireCollectorRunLock(root);

    assert.equal(acquired, true);
    await stat(collectorRunLockFile(root));

    await releaseCollectorRunLock(root);
  });

  it("refreshes the collector run lock heartbeat without changing ownership", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-lock-refresh-"));
    const acquired = await acquireCollectorRunLock(root);
    assert.equal(acquired, true);

    const before = await stat(collectorRunLockFile(root));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await refreshCollectorRunLock(root);
    const after = await stat(collectorRunLockFile(root));

    assert.equal(after.mtimeMs >= before.mtimeMs, true);
    await releaseCollectorRunLock(root);
  });

  it("does not steal a stale-looking collector lock while the owner pid is alive", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-lock-alive-"));
    const now = Date.now();
    await mkdir(join(root, "marmonitor", "collector"), { recursive: true });
    await writeFile(
      collectorRunLockFile(root),
      JSON.stringify({ pid: process.pid, createdAt: now - 60_000, updatedAt: now - 60_000 }),
    );
    const staleSec = (now - 60_000) / 1000;
    await utimes(collectorRunLockFile(root), staleSec, staleSec);

    const acquired = await acquireCollectorRunLock(root);
    assert.equal(acquired, false);
  });

  it("reclaims a fresh-looking collector lock immediately when the recorded pid is gone", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-lock-reclaim-"));
    const now = Date.now();
    await mkdir(join(root, "marmonitor", "collector"), { recursive: true });
    await writeFile(
      collectorRunLockFile(root),
      JSON.stringify({ pid: -1, createdAt: now, updatedAt: now }),
    );

    const acquired = await acquireCollectorRunLock(root);
    assert.equal(acquired, true);
    await releaseCollectorRunLock(root);
  });

  it("returns a healthy collector snapshot when health and snapshot are both present", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-client-"));
    const now = Date.now();
    await writeCollectorHealth(
      {
        pid: 999,
        startedAt: now,
        lastTickAt: now,
        lastSuccessAt: now,
        snapshotGeneratedAt: now,
        state: "idle",
        version: "test",
        snapshotTtlMs: getDefaults().performance.snapshotTtlMs,
        statuslineTtlMs: getDefaults().performance.statuslineTtlMs,
        statuslineAttentionLimit: getDefaults().display.statuslineAttentionLimit,
      },
      root,
    );
    await writeCollectorSnapshot(
      [
        {
          pid: 7,
          agentName: "Codex",
          cwd: "/repo",
          status: "Idle",
          runtimeSource: "cli",
        },
      ],
      root,
    );

    const snapshot = await readHealthyCollectorSnapshot(getDefaults(), root);
    assert.equal(snapshot?.[0]?.pid, 7);
  });

  it("returns a healthy collector statusline when health and text are both present", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-client-statusline-"));
    const now = Date.now();
    await writeCollectorHealth(
      {
        pid: 999,
        startedAt: now,
        lastTickAt: now,
        lastSuccessAt: now,
        snapshotGeneratedAt: now - 1_000,
        state: "idle",
        version: "test",
        snapshotTtlMs: getDefaults().performance.snapshotTtlMs,
        statuslineTtlMs: getDefaults().performance.statuslineTtlMs,
        statuslineAttentionLimit: 5,
      },
      root,
    );
    await writeCollectorStatusline("compact", 5, undefined, "AI14 | 20%", root);

    const statusline = await readHealthyCollectorStatusline({
      config: getDefaults(),
      format: "compact",
      attentionLimit: 5,
      root,
    });
    assert.equal(statusline, "AI14 | 20%");
  });

  it("returns a current collector statusline without loading config when health matches the config path", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-current-statusline-"));
    const now = Date.now();
    await writeCollectorHealth(
      {
        pid: 1001,
        startedAt: now,
        lastTickAt: now,
        lastSuccessAt: now,
        snapshotGeneratedAt: now - 1_000,
        state: "idle",
        version: "test",
        configPath: "/tmp/settings.json",
        snapshotTtlMs: 2_000,
        statuslineTtlMs: 2_000,
        statuslineAttentionLimit: 5,
      },
      root,
    );
    await writeCollectorStatusline("compact", 5, undefined, "AI7 | 10%", root);

    const statusline = await readCurrentCollectorStatusline({
      requestedConfigPath: "/tmp/settings.json",
      format: "compact",
      root,
    });
    assert.equal(statusline, "AI7 | 10%");
  });

  it("reuses the last good collector statusline while the collector is refreshing", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-refreshing-statusline-"));
    const now = Date.now();
    await writeCollectorHealth(
      {
        pid: 1004,
        startedAt: now - 5_000,
        lastTickAt: now - 100,
        lastSuccessAt: now - 2_000,
        snapshotGeneratedAt: now - 2_000,
        state: "refreshing",
        version: "test",
        configPath: "/tmp/settings.json",
        snapshotTtlMs: 10_000,
        statuslineTtlMs: 10_000,
        statuslineAttentionLimit: 5,
      },
      root,
    );
    await writeCollectorStatusline("compact", 5, undefined, "AI9 | 11%", root);

    const statusline = await readCurrentCollectorStatusline({
      requestedConfigPath: "/tmp/settings.json",
      format: "compact",
      root,
    });
    assert.equal(statusline, "AI9 | 11%");
  });

  it("does not reuse a stale collector statusline older than the latest snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-stale-statusline-"));
    await writeCollectorStatusline("tmux-badges", 5, 214, "AI:0", root);
    const now = Date.now();
    const staleSec = (now - 60_000) / 1000;
    await utimes(collectorStatuslineFile("tmux-badges", 5, 214, root), staleSec, staleSec);
    await writeCollectorHealth(
      {
        pid: 1003,
        startedAt: now,
        lastTickAt: now,
        lastSuccessAt: now,
        snapshotGeneratedAt: now,
        state: "idle",
        version: "test",
        configPath: "/tmp/settings.json",
        snapshotTtlMs: 10_000,
        statuslineTtlMs: 10_000,
        statuslineAttentionLimit: 5,
      },
      root,
    );

    const statusline = await readCurrentCollectorStatusline({
      requestedConfigPath: "/tmp/settings.json",
      format: "tmux-badges",
      width: 214,
      root,
    });
    assert.equal(statusline, undefined);
  });

  it("can still serve a recent stale collector statusline while a newer snapshot is being written", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-stale-serve-"));
    const now = Date.now();
    await writeCollectorStatusline("tmux-badges", 5, 214, "AI:7", root);
    const slightlyStaleSec = (now - 5_000) / 1000;
    await utimes(collectorStatuslineFile("tmux-badges", 5, 214, root), slightlyStaleSec, slightlyStaleSec);
    await writeCollectorHealth(
      {
        pid: 1005,
        startedAt: now - 5_000,
        lastTickAt: now - 200,
        lastSuccessAt: now - 2_000,
        snapshotGeneratedAt: now,
        state: "refreshing",
        version: "test",
        configPath: "/tmp/settings.json",
        snapshotTtlMs: 10_000,
        statuslineTtlMs: 10_000,
        statuslineAttentionLimit: 5,
      },
      root,
    );

    const statusline = await readCollectorStatuslineForRequest({
      requestedConfigPath: "/tmp/settings.json",
      format: "tmux-badges",
      width: 214,
      root,
    });
    assert.deepEqual(statusline, {
      value: "AI:7",
      attentionLimit: 5,
      freshness: "stale",
    });
  });

  it("does not reuse collector snapshot artifacts when config paths do not match", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-collector-config-mismatch-"));
    const now = Date.now();
    const config = getDefaults();
    await writeCollectorHealth(
      {
        pid: 1002,
        startedAt: now,
        lastTickAt: now,
        lastSuccessAt: now,
        snapshotGeneratedAt: now,
        state: "idle",
        version: "test",
        configPath: "/tmp/other-settings.json",
        snapshotTtlMs: config.performance.snapshotTtlMs,
        statuslineTtlMs: config.performance.statuslineTtlMs,
        statuslineAttentionLimit: config.display.statuslineAttentionLimit,
      },
      root,
    );
    await writeCollectorSnapshot(
      [
        {
          pid: 8,
          agentName: "Claude Code",
          cwd: "/repo",
          status: "Idle",
          runtimeSource: "cli",
        },
      ],
      root,
    );

    const snapshot = await readHealthyCollectorSnapshotForRequest({
      config,
      requestedConfigPath: "/tmp/settings.json",
      root,
    });
    assert.equal(snapshot, undefined);
  });
});
