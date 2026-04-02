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
import {
  appendJumpBackIndicator,
  parseStatuslineClientArgs,
  promoteTmuxPidRangeToBack,
  underlineTmuxPidRange,
} from "../dist/statusline-client.js";
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
    assert.equal(appendJumpBackIndicator("Cx 2", true), "Cx 2  #[range=user|back]↩#[norange]");
  });

  it("inserts the jump-back indicator between tmux summary and detail items", () => {
    assert.equal(
      appendJumpBackIndicator(
        "Cl 1 Cx 8  #[range=user|pid:10]1 🤔Cx repo 3s#[norange]  #[range=user|pid:20]2 Cx app 1m#[norange]",
        true,
      ),
      "Cl 1 Cx 8  #[range=user|back]↩#[norange]  #[range=user|pid:10]1 🤔Cx repo 3s#[norange]  #[range=user|pid:20]2 Cx app 1m#[norange]",
    );
  });

  it("adds a second jump-back indicator immediately before the idle rail", () => {
    assert.equal(
      appendJumpBackIndicator(
        "Cl 1 Cx 8  #[range=user|pid:10]1 🤔Cx repo 3s#[norange]      #[range=user|sum:idle]warm Cl1 Cx1#[norange] | #[range=user|pid:30]marmonitor#[norange]",
        true,
      ),
      "Cl 1 Cx 8  #[range=user|back]↩#[norange]  #[range=user|pid:10]1 🤔Cx repo 3s#[norange]      #[range=user|back]↩#[norange]  #[range=user|sum:idle]warm Cl1 Cx1#[norange] | #[range=user|pid:30]marmonitor#[norange]",
    );
  });

  it("shows both jump-back indicators when only summary and idle rail are present", () => {
    assert.equal(
      appendJumpBackIndicator(
        "Cx 1        #[range=user|sum:idle]warm Cx1#[norange] | #[range=user|pid:30]marmonitor#[norange]",
        true,
      ),
      "Cx 1  #[range=user|back]↩#[norange]        #[range=user|back]↩#[norange]  #[range=user|sum:idle]warm Cx1#[norange] | #[range=user|pid:30]marmonitor#[norange]",
    );
  });

  it("underlines only the requested pid range", () => {
    assert.equal(
      underlineTmuxPidRange(
        "Cl 1 Cx 1  #[range=user|pid:10]1 🤔Cx repo 3s#[norange]  #[range=user|pid:20]2 ✅Cl app 5s#[norange]",
        20,
      ),
      "Cl 1 Cx 1  #[range=user|pid:10]1 🤔Cx repo 3s#[norange]  #[range=user|pid:20]#[underscore]2 ✅Cl app 5s#[nounderscore]#[norange]",
    );
  });

  it("promotes the requested pid range into a jump-back click target", () => {
    assert.equal(
      promoteTmuxPidRangeToBack("Cl 1 Cx 1  #[range=user|pid:20]2 ✅Cl app 5s#[norange]", 20),
      "Cl 1 Cx 1  #[range=user|back]#[underscore]2 ✅Cl app 5s#[nounderscore]#[norange]",
    );
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

  it("serves a stale collector statusline via the thin statusline binary without falling back", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-statusline-thin-stale-bin-"));
    const requestedConfigPath = "/tmp/nonexistent-settings.json";
    const now = Date.now();
    await writeCollectorStatusline("compact", 5, undefined, "AI12 | stale", root);
    const staleAt = new Date(now - 30_000);
    await utimes(collectorStatuslineFile("compact", 5, undefined, root), staleAt, staleAt);
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

    assert.equal(stdout.trim(), "AI12 | stale");
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
        statuslineAttentionLimit: 5,
      },
      root,
    );
    await writeCollectorStatusline("tmux-badges", 5, undefined, "Cx 1", root);
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

    assert.equal(stdout.trim(), "Cx 1  #[range=user|back]↩#[norange]");
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

  it("underlines the origin session when it is visible in the current tmux statusline", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-statusline-origin-highlight-"));
    const requestedConfigPath = "/tmp/nonexistent-settings.json";
    const now = Date.now();
    await writeCollectorHealth(
      {
        pid: 2222,
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
    await writeCollectorSnapshot(
      [
        {
          pid: 31,
          agentName: "Codex",
          cwd: "/repo/marmonitor",
          status: "Active",
          phase: "thinking",
          lastActivityAt: Math.floor(now / 1000) - 5,
          runtimeSource: "cli",
        },
      ],
      root,
    );
    await writeCollectorStatusline(
      "tmux-badges",
      5,
      220,
      "Cx 1  #[range=user|pid:31]1 🤔Cx marmonitor 5s#[norange]",
      root,
    );
    await writeJumpAnchor(
      {
        clientId: "$1",
        clientTty: "/dev/ttys001",
        originSessionId: "$session",
        originWindowId: "@1",
        originPaneId: "%1",
        originCwd: "/repo/marmonitor",
        recordedAt: now,
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
        "--width",
        "220",
        "--client-tty",
        "/dev/ttys001",
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

    assert.match(
      stdout.trim(),
      /#\[range=user\|back]#\[underscore]1 🤔Cx marmonitor 5s#\[nounderscore]#\[norange]/,
    );
  });

  it("keeps the origin overlay off when the anchored cwd is not visible", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-statusline-origin-hidden-"));
    const requestedConfigPath = "/tmp/nonexistent-settings.json";
    const now = Date.now();
    await writeCollectorHealth(
      {
        pid: 3333,
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
    await writeCollectorSnapshot(
      [
        {
          pid: 31,
          agentName: "Codex",
          cwd: "/repo/other",
          status: "Active",
          phase: "thinking",
          lastActivityAt: Math.floor(now / 1000) - 5,
          runtimeSource: "cli",
        },
      ],
      root,
    );
    await writeCollectorStatusline(
      "tmux-badges",
      5,
      220,
      "Cx 1  #[range=user|pid:31]1 🤔Cx other 5s#[norange]",
      root,
    );
    await writeJumpAnchor(
      {
        clientId: "$1",
        clientTty: "/dev/ttys001",
        originSessionId: "$session",
        originWindowId: "@1",
        originPaneId: "%1",
        originCwd: "/repo/marmonitor",
        recordedAt: now,
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
        "--width",
        "220",
        "--client-tty",
        "/dev/ttys001",
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

    assert.doesNotMatch(stdout.trim(), /#\[underscore]/);
  });

  it("keeps the origin overlay off when multiple visible items share the origin cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-statusline-origin-ambiguous-"));
    const requestedConfigPath = "/tmp/nonexistent-settings.json";
    const now = Date.now();
    await writeCollectorHealth(
      {
        pid: 4444,
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
    await writeCollectorSnapshot(
      [
        {
          pid: 31,
          agentName: "Codex",
          cwd: "/repo/marmonitor",
          status: "Active",
          phase: "thinking",
          lastActivityAt: Math.floor(now / 1000) - 5,
          runtimeSource: "cli",
        },
        {
          pid: 32,
          agentName: "Claude Code",
          cwd: "/repo/marmonitor",
          status: "Active",
          phase: "tool",
          lastActivityAt: Math.floor(now / 1000) - 6,
          runtimeSource: "cli",
        },
      ],
      root,
    );
    await writeCollectorStatusline(
      "tmux-badges",
      5,
      220,
      "Cl 1 Cx 1  #[range=user|pid:31]1 🤔Cx marmonitor 5s#[norange]  #[range=user|pid:32]2 🔧Cl marmonitor +1 6s#[norange]",
      root,
    );
    await writeJumpAnchor(
      {
        clientId: "$1",
        clientTty: "/dev/ttys001",
        originSessionId: "$session",
        originWindowId: "@1",
        originPaneId: "%1",
        originCwd: "/repo/marmonitor",
        recordedAt: now,
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
        "--width",
        "220",
        "--client-tty",
        "/dev/ttys001",
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

    assert.doesNotMatch(stdout.trim(), /#\[range=user\|back]#\[underscore]/);
  });
});
