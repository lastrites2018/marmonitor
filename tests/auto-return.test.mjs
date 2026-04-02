import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDefaults } from "../dist/config/index.js";
import {
  AUTO_RETURN_ACTIVE_CLIENT_GRACE_MS,
  runStaleJumpAutoReturnMaintenance,
} from "../dist/tmux/auto-return.js";

function createConfig(overrides = {}) {
  return {
    ...getDefaults().integration.tmux.jumpBack.autoReturn,
    ...overrides,
  };
}

function createTmuxSnapshot() {
  return {
    panes: [
      {
        target: "work:1.2",
        sessionName: "work",
        sessionId: "$target",
        windowId: "@2",
        windowIndex: 1,
        paneId: "%2",
        paneIndex: 2,
        panePid: 100,
        cwd: "/repo/marmonitor",
      },
    ],
    childMap: new Map([[100, [101]]]),
  };
}

describe("stale jump auto-return", () => {
  it("does nothing before the idle threshold elapses", async () => {
    let jumpCalls = 0;
    const nowMs = 1_712_020_000_000;

    const result = await runStaleJumpAutoReturnMaintenance(
      [
        {
          agentName: "Codex",
          pid: 101,
          cwd: "/repo/marmonitor",
          cpuPercent: 0,
          memoryMb: 10,
          status: "Idle",
          sessionMatched: true,
          idleSince: nowMs / 1000 - 10 * 60,
        },
      ],
      createConfig({ enabled: true, afterIdleMin: 30 }),
      createTmuxSnapshot(),
      {
        nowMs,
        listJumpAnchorClientIds: async () => ["$3"],
        readJumpAnchor: async () => ({
          clientId: "$3",
          clientTty: "/dev/ttys032",
          originSessionId: "$origin",
          originWindowId: "@1",
          originPaneId: "%1",
          lastJumpTargetSessionId: "$target",
          lastJumpTargetWindowId: "@2",
          lastJumpTargetPaneId: "%2",
          recordedAt: nowMs - 60_000,
          lastJumpedAt: nowMs - 60_000,
        }),
        listTmuxClientLocations: async () => [
          {
            clientId: "$3",
            clientTty: "/dev/ttys032",
            sessionId: "$target",
            sessionName: "work",
            windowId: "@2",
            windowIndex: 1,
            paneId: "%2",
            paneIndex: 2,
            clientActivityAt: (nowMs - AUTO_RETURN_ACTIVE_CLIENT_GRACE_MS - 10_000) / 1000,
          },
        ],
        jumpBackToTmuxAnchor: async () => {
          jumpCalls += 1;
          return {
            found: true,
            executed: true,
            insideTmux: false,
          };
        },
        clearJumpAnchor: async () => {},
      },
    );

    assert.equal(result.checked, 1);
    assert.equal(result.executed, 0);
    assert.equal(jumpCalls, 0);
  });

  it("returns to origin and clears the anchor when the target stays idle long enough", async () => {
    let clearedClientId;
    let jumpOptions;
    const nowMs = 1_712_020_000_000;

    const result = await runStaleJumpAutoReturnMaintenance(
      [
        {
          agentName: "Codex",
          pid: 101,
          cwd: "/repo/marmonitor",
          cpuPercent: 0,
          memoryMb: 10,
          status: "Idle",
          sessionMatched: true,
          idleSince: nowMs / 1000 - 31 * 60,
          lastActivityAt: nowMs / 1000 - 31 * 60,
        },
      ],
      createConfig({ enabled: true, afterIdleMin: 30 }),
      createTmuxSnapshot(),
      {
        nowMs,
        listJumpAnchorClientIds: async () => ["$3"],
        readJumpAnchor: async () => ({
          clientId: "$3",
          clientTty: "/dev/ttys032",
          originSessionId: "$origin",
          originWindowId: "@1",
          originPaneId: "%1",
          lastJumpTargetSessionId: "$target",
          lastJumpTargetWindowId: "@2",
          lastJumpTargetPaneId: "%2",
          recordedAt: nowMs - 60_000,
          lastJumpedAt: nowMs - 60_000,
        }),
        listTmuxClientLocations: async () => [
          {
            clientId: "$3",
            clientTty: "/dev/ttys032",
            sessionId: "$target",
            sessionName: "work",
            windowId: "@2",
            windowIndex: 1,
            paneId: "%2",
            paneIndex: 2,
            clientActivityAt: (nowMs - AUTO_RETURN_ACTIVE_CLIENT_GRACE_MS - 10_000) / 1000,
          },
        ],
        jumpBackToTmuxAnchor: async (_anchor, options) => {
          jumpOptions = options;
          return {
            found: true,
            executed: true,
            insideTmux: false,
          };
        },
        clearJumpAnchor: async (clientId) => {
          clearedClientId = clientId;
        },
      },
    );

    assert.equal(result.checked, 1);
    assert.equal(result.executed, 1);
    assert.equal(result.cleared, 1);
    assert.equal(clearedClientId, "$3");
    assert.equal(jumpOptions?.targetClient, "/dev/ttys032");
  });

  it("does nothing when the client has moved away from the last jump target", async () => {
    let jumpCalls = 0;
    const nowMs = 1_712_020_000_000;

    const result = await runStaleJumpAutoReturnMaintenance(
      [
        {
          agentName: "Codex",
          pid: 101,
          cwd: "/repo/marmonitor",
          cpuPercent: 0,
          memoryMb: 10,
          status: "Idle",
          sessionMatched: true,
          idleSince: nowMs / 1000 - 31 * 60,
        },
      ],
      createConfig({ enabled: true, afterIdleMin: 30 }),
      createTmuxSnapshot(),
      {
        nowMs,
        listJumpAnchorClientIds: async () => ["$3"],
        readJumpAnchor: async () => ({
          clientId: "$3",
          clientTty: "/dev/ttys032",
          originSessionId: "$origin",
          originWindowId: "@1",
          originPaneId: "%1",
          lastJumpTargetSessionId: "$target",
          lastJumpTargetWindowId: "@2",
          lastJumpTargetPaneId: "%2",
          recordedAt: nowMs - 60_000,
          lastJumpedAt: nowMs - 60_000,
        }),
        listTmuxClientLocations: async () => [
          {
            clientId: "$3",
            clientTty: "/dev/ttys032",
            sessionId: "$target",
            sessionName: "work",
            windowId: "@2",
            windowIndex: 1,
            paneId: "%9",
            paneIndex: 9,
            clientActivityAt: (nowMs - AUTO_RETURN_ACTIVE_CLIENT_GRACE_MS - 10_000) / 1000,
          },
        ],
        jumpBackToTmuxAnchor: async () => {
          jumpCalls += 1;
          return {
            found: true,
            executed: true,
            insideTmux: false,
          };
        },
        clearJumpAnchor: async () => {},
      },
    );

    assert.equal(result.executed, 0);
    assert.equal(jumpCalls, 0);
  });

  it("skips auto-return when client activity is too recent", async () => {
    let jumpCalls = 0;
    const nowMs = 1_712_020_000_000;

    const result = await runStaleJumpAutoReturnMaintenance(
      [
        {
          agentName: "Codex",
          pid: 101,
          cwd: "/repo/marmonitor",
          cpuPercent: 0,
          memoryMb: 10,
          status: "Idle",
          sessionMatched: true,
          idleSince: nowMs / 1000 - 31 * 60,
        },
      ],
      createConfig({ enabled: true, afterIdleMin: 30 }),
      createTmuxSnapshot(),
      {
        nowMs,
        listJumpAnchorClientIds: async () => ["$3"],
        readJumpAnchor: async () => ({
          clientId: "$3",
          clientTty: "/dev/ttys032",
          originSessionId: "$origin",
          originWindowId: "@1",
          originPaneId: "%1",
          lastJumpTargetSessionId: "$target",
          lastJumpTargetWindowId: "@2",
          lastJumpTargetPaneId: "%2",
          recordedAt: nowMs - 60_000,
          lastJumpedAt: nowMs - 60_000,
        }),
        listTmuxClientLocations: async () => [
          {
            clientId: "$3",
            clientTty: "/dev/ttys032",
            sessionId: "$target",
            sessionName: "work",
            windowId: "@2",
            windowIndex: 1,
            paneId: "%2",
            paneIndex: 2,
            clientActivityAt: nowMs / 1000,
          },
        ],
        jumpBackToTmuxAnchor: async () => {
          jumpCalls += 1;
          return {
            found: true,
            executed: true,
            insideTmux: false,
          };
        },
        clearJumpAnchor: async () => {},
      },
    );

    assert.equal(result.executed, 0);
    assert.equal(jumpCalls, 0);
  });

  it("clears invalid origins when jump-back reports the anchor as invalid", async () => {
    let clearedClientId;
    const nowMs = 1_712_020_000_000;

    const result = await runStaleJumpAutoReturnMaintenance(
      [
        {
          agentName: "Codex",
          pid: 101,
          cwd: "/repo/marmonitor",
          cpuPercent: 0,
          memoryMb: 10,
          status: "Idle",
          sessionMatched: true,
          idleSince: nowMs / 1000 - 31 * 60,
        },
      ],
      createConfig({ enabled: true, afterIdleMin: 30 }),
      createTmuxSnapshot(),
      {
        nowMs,
        listJumpAnchorClientIds: async () => ["$3"],
        readJumpAnchor: async () => ({
          clientId: "$3",
          clientTty: "/dev/ttys032",
          originSessionId: "$origin",
          originWindowId: "@1",
          originPaneId: "%1",
          lastJumpTargetSessionId: "$target",
          lastJumpTargetWindowId: "@2",
          lastJumpTargetPaneId: "%2",
          recordedAt: nowMs - 60_000,
          lastJumpedAt: nowMs - 60_000,
        }),
        listTmuxClientLocations: async () => [
          {
            clientId: "$3",
            clientTty: "/dev/ttys032",
            sessionId: "$target",
            sessionName: "work",
            windowId: "@2",
            windowIndex: 1,
            paneId: "%2",
            paneIndex: 2,
            clientActivityAt: (nowMs - AUTO_RETURN_ACTIVE_CLIENT_GRACE_MS - 10_000) / 1000,
          },
        ],
        jumpBackToTmuxAnchor: async () => ({
          found: true,
          executed: false,
          insideTmux: false,
          anchorInvalid: true,
        }),
        clearJumpAnchor: async (clientId) => {
          clearedClientId = clientId;
        },
      },
    );

    assert.equal(result.executed, 0);
    assert.equal(result.cleared, 1);
    assert.equal(clearedClientId, "$3");
  });
});
