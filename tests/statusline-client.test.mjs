import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, unlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  collectorSnapshotFile,
  collectorStatuslineFile,
  readCollectorStatusline,
  writeCollectorHealth,
  writeCollectorSnapshot,
  writeCollectorStatusline,
} from "../dist/collector/store.js";
import { getDefaults } from "../dist/config/index.js";
import { appendJumpBackIndicator, parseStatuslineClientArgs } from "../dist/statusline-client.js";
import { writeJumpAnchor } from "../dist/tmux/jump-anchor.js";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliBinPath = join(repoRoot, "bin", "marmonitor.js");
const statuslineBinPath = join(repoRoot, "bin", "marmonitor-statusline.js");

describe("statusline client", () => {
  it("parses statusline-specific arguments without commander", () => {
    const parsed = parseStatuslineClientArgs([
      "--statusline",
      "--statusline-format",
      "extended",
      "--width",
      "120",
      "--config",
      "/tmp/settings.json",
    ]);

    assert.deepEqual(parsed, {
      format: "extended",
      width: 120,
      configPath: "/tmp/settings.json",
      clientTty: undefined,
    });
  });

  it("parses client tty for tmux-aware statusline requests", () => {
    const parsed = parseStatuslineClientArgs([
      "--statusline",
      "--statusline-format",
      "tmux-badges",
      "--client-tty",
      "/dev/ttys032",
    ]);

    assert.deepEqual(parsed, {
      format: "tmux-badges",
      width: undefined,
      configPath: undefined,
      clientTty: "/dev/ttys032",
    });
  });

  it("appends a compact jump-back indicator only when an anchor exists", () => {
    assert.equal(appendJumpBackIndicator("Cx 2", false), "Cx 2");
    assert.equal(appendJumpBackIndicator("Cx 2", true), "Cx 2 ↩");
  });

  it("serves collector statusline via the main wrapper without full CLI bootstrap", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-statusline-wrapper-"));
    const requestedConfigPath = "/tmp/nonexistent-settings.json";
    const now = Date.now();
    await writeCollectorHealth(
      {
        pid: 4321,
        startedAt: now,
        lastTickAt: now,
        lastSuccessAt: now,
        snapshotGeneratedAt: now,
        state: "idle",
        version: "test",
        configPath: requestedConfigPath,
        snapshotTtlMs: 10_000,
        statuslineTtlMs: 10_000,
        statuslineAttentionLimit: 5,
      },
      root,
    );
    await writeCollectorStatusline("compact", 5, undefined, "AI99 | 1%", root);

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cliBinPath,
        "--statusline",
        "--statusline-format",
        "compact",
        "--config",
        requestedConfigPath,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          TMPDIR: root,
          HOME: root,
          MARMONITOR_CLAUDE_HOME: join(root, ".claude"),
          MARMONITOR_CODEX_HOME: join(root, ".codex"),
        },
        encoding: "utf8",
      },
    );

    assert.equal(stdout.trim(), "AI99 | 1%");
  });

  it("serves collector statusline via the thin statusline binary", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-statusline-thin-bin-"));
    const requestedConfigPath = "/tmp/nonexistent-settings.json";
    const now = Date.now();
    await writeCollectorHealth(
      {
        pid: 9876,
        startedAt: now,
        lastTickAt: now,
        lastSuccessAt: now,
        snapshotGeneratedAt: now,
        state: "idle",
        version: "test",
        configPath: requestedConfigPath,
        snapshotTtlMs: 10_000,
        statuslineTtlMs: 10_000,
        statuslineAttentionLimit: 5,
      },
      root,
    );
    await writeCollectorStatusline("compact", 5, undefined, "AI12 | 8%", root);

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        statuslineBinPath,
        "--statusline",
        "--statusline-format",
        "compact",
        "--config",
        requestedConfigPath,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          TMPDIR: root,
          HOME: root,
          MARMONITOR_CLAUDE_HOME: join(root, ".claude"),
          MARMONITOR_CODEX_HOME: join(root, ".codex"),
        },
        encoding: "utf8",
      },
    );

    assert.equal(stdout.trim(), "AI12 | 8%");
  });

  it("adds a jump-back indicator when the current client has an anchor", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-statusline-anchor-indicator-"));
    const requestedConfigPath = "/tmp/nonexistent-settings.json";
    const now = Date.now();
    await writeCollectorHealth(
      {
        pid: 9876,
        startedAt: now,
        lastTickAt: now,
        lastSuccessAt: now,
        snapshotGeneratedAt: now,
        state: "idle",
        version: "test",
        configPath: requestedConfigPath,
        snapshotTtlMs: 10_000,
        statuslineTtlMs: 10_000,
        statuslineAttentionLimit: 8,
      },
      root,
    );
    await writeCollectorStatusline("tmux-badges", 8, undefined, "Cx 1", root);
    await writeJumpAnchor(
      {
        clientId: "$3",
        clientTty: "/dev/ttys032",
        originSessionId: "$1",
        originWindowId: "@41",
        originPaneId: "%118",
        recordedAt: now,
        lastJumpedAt: now,
      },
      root,
    );

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        statuslineBinPath,
        "--statusline",
        "--statusline-format",
        "tmux-badges",
        "--config",
        requestedConfigPath,
        "--client-tty",
        "/dev/ttys032",
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          TMPDIR: root,
          HOME: root,
          MARMONITOR_CLAUDE_HOME: join(root, ".claude"),
          MARMONITOR_CODEX_HOME: join(root, ".codex"),
        },
        encoding: "utf8",
      },
    );

    assert.equal(stdout.trim(), "Cx 1 ↩");
  });

  it("materializes width-specific collector statuslines from the collector snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-statusline-width-materialize-"));
    const statuslineAttentionLimit = getDefaults().display.statuslineAttentionLimit;
    const now = Date.now();
    await writeCollectorHealth(
      {
        pid: 7777,
        startedAt: now,
        lastTickAt: now,
        lastSuccessAt: now,
        snapshotGeneratedAt: now,
        state: "idle",
        version: "test",
        snapshotTtlMs: 10_000,
        statuslineTtlMs: 10_000,
        statuslineAttentionLimit,
      },
      root,
    );
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

    const first = await execFileAsync(
      process.execPath,
      [statuslineBinPath, "--statusline", "--statusline-format", "tmux-badges", "--width", "120"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          TMPDIR: root,
          HOME: root,
          MARMONITOR_CLAUDE_HOME: join(root, ".claude"),
          MARMONITOR_CODEX_HOME: join(root, ".codex"),
        },
        encoding: "utf8",
      },
    );

    const widthStatusline = await readCollectorStatusline(
      "tmux-badges",
      statuslineAttentionLimit,
      120,
      10_000,
      root,
    );
    assert.equal(widthStatusline?.value, first.stdout.trim());

    await unlink(collectorSnapshotFile(root));

    const second = await execFileAsync(
      process.execPath,
      [statuslineBinPath, "--statusline", "--statusline-format", "tmux-badges", "--width", "120"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          TMPDIR: root,
          HOME: root,
          MARMONITOR_CLAUDE_HOME: join(root, ".claude"),
          MARMONITOR_CODEX_HOME: join(root, ".codex"),
        },
        encoding: "utf8",
      },
    );

    assert.equal(second.stdout.trim(), first.stdout.trim());
  });

  it("rebuilds a stale width-specific collector statusline from the current snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-statusline-width-refresh-"));
    const statuslineAttentionLimit = getDefaults().display.statuslineAttentionLimit;
    await writeCollectorStatusline("tmux-badges", statuslineAttentionLimit, 214, "AI:0", root);
    const now = Date.now();
    const staleSec = (now - 60_000) / 1000;
    await utimes(
      collectorStatuslineFile("tmux-badges", statuslineAttentionLimit, 214, root),
      staleSec,
      staleSec,
    );
    await writeCollectorHealth(
      {
        pid: 5555,
        startedAt: now,
        lastTickAt: now,
        lastSuccessAt: now,
        snapshotGeneratedAt: now,
        state: "idle",
        version: "test",
        snapshotTtlMs: 10_000,
        statuslineTtlMs: 10_000,
        statuslineAttentionLimit,
      },
      root,
    );
    await writeCollectorSnapshot(
      [
        {
          pid: 1,
          agentName: "Codex",
          cwd: "/repo",
          status: "Idle",
          runtimeSource: "cli",
        },
      ],
      root,
    );

    const { stdout } = await execFileAsync(
      process.execPath,
      [statuslineBinPath, "--statusline", "--statusline-format", "tmux-badges", "--width", "214"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          TMPDIR: root,
          HOME: root,
          MARMONITOR_CLAUDE_HOME: join(root, ".claude"),
          MARMONITOR_CODEX_HOME: join(root, ".codex"),
        },
        encoding: "utf8",
      },
    );

    assert.notEqual(stdout.trim(), "AI:0");
    const widthStatusline = await readCollectorStatusline(
      "tmux-badges",
      statuslineAttentionLimit,
      214,
      10_000,
      root,
    );
    assert.equal(widthStatusline?.value, stdout.trim());
  });
});
