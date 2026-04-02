import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JUMP_BRIEFING_TTL_MS } from "../dist/tmux/jump-briefing.js";
import { jumpToAgentWithAnchor } from "../dist/tmux/navigation.js";

const CURRENT_CLIENT = {
  clientId: "$1",
  clientTty: "/dev/ttys001",
  sessionId: "$session",
  sessionName: "work",
  windowId: "@1",
  windowIndex: 1,
  paneId: "%1",
  paneIndex: 1,
};

describe("tmux navigation", () => {
  it("treats a jump to the current pane as a noop and skips anchor creation", async () => {
    let jumpCalls = 0;
    let writeCalls = 0;

    const result = await jumpToAgentWithAnchor(
      { pid: 42, cwd: "/repo/marmonitor" },
      { insideTmux: true },
      {
        listTmuxClientIds: async () => [CURRENT_CLIENT.clientId],
        pruneJumpAnchors: async () => {},
        resolveTmuxClientLocation: async () => CURRENT_CLIENT,
        readJumpAnchor: async () => undefined,
        resolveTmuxJumpTarget: async () => ({
          pane: {
            target: "work:1.1",
            sessionName: "work",
            windowIndex: 1,
            paneIndex: 1,
            panePid: 100,
            cwd: "/repo/marmonitor",
          },
          match: "cwd",
        }),
        jumpToTmuxPane: async () => {
          jumpCalls += 1;
          return true;
        },
        writeJumpAnchor: async () => {
          writeCalls += 1;
        },
      },
    );

    assert.equal(result.found, true);
    assert.equal(result.executed, true);
    assert.equal(result.noop, true);
    assert.match(result.message ?? "", /anchor unchanged/);
    assert.equal(jumpCalls, 0);
    assert.equal(writeCalls, 0);
  });

  it("keeps an existing anchor untouched when a same-pane jump becomes a noop", async () => {
    let writeCalls = 0;

    const result = await jumpToAgentWithAnchor(
      { pid: 42, cwd: "/repo/marmonitor" },
      { insideTmux: true },
      {
        listTmuxClientIds: async () => [CURRENT_CLIENT.clientId],
        pruneJumpAnchors: async () => {},
        resolveTmuxClientLocation: async () => CURRENT_CLIENT,
        readJumpAnchor: async () => ({
          clientId: CURRENT_CLIENT.clientId,
          clientTty: CURRENT_CLIENT.clientTty,
          originSessionId: CURRENT_CLIENT.sessionId,
          originWindowId: CURRENT_CLIENT.windowId,
          originPaneId: CURRENT_CLIENT.paneId,
          originCwd: "/repo/marmonitor",
          recordedAt: Date.now(),
        }),
        resolveTmuxJumpTarget: async () => ({
          pane: {
            target: "work:1.1",
            sessionName: "work",
            windowIndex: 1,
            paneIndex: 1,
            panePid: 100,
            cwd: "/repo/marmonitor",
          },
          match: "cwd",
        }),
        jumpToTmuxPane: async () => true,
        writeJumpAnchor: async () => {
          writeCalls += 1;
        },
      },
    );

    assert.equal(result.noop, true);
    assert.equal(writeCalls, 0);
  });

  it("still jumps and records an anchor when the target is a different pane in the same session", async () => {
    let jumpCalls = 0;
    let writtenAnchor;
    let writtenBriefing;

    const result = await jumpToAgentWithAnchor(
      { pid: 42, cwd: "/repo/marmonitor" },
      { insideTmux: true },
      {
        listTmuxClientIds: async () => [CURRENT_CLIENT.clientId],
        listTmuxPanes: async () => [
          {
            target: "work:1.1",
            sessionName: "work",
            windowIndex: 1,
            paneIndex: 1,
            panePid: 100,
            cwd: "/repo/marmonitor",
          },
        ],
        pruneJumpAnchors: async () => {},
        resolveTmuxClientLocation: async () => CURRENT_CLIENT,
        readJumpAnchor: async () => undefined,
        resolveTmuxJumpTarget: async () => ({
          pane: {
            target: "work:1.2",
            sessionName: "work",
            sessionId: "$target",
            windowId: "@2",
            windowIndex: 1,
            paneId: "%2",
            paneIndex: 2,
            panePid: 101,
            cwd: "/repo/marmonitor",
          },
          match: "cwd",
        }),
        jumpToTmuxPane: async () => {
          jumpCalls += 1;
          return true;
        },
        writeJumpBriefing: async (briefing) => {
          writtenBriefing = briefing;
        },
        writeJumpAnchor: async (anchor) => {
          writtenAnchor = anchor;
        },
      },
    );

    assert.equal(result.executed, true);
    assert.equal(result.noop, false);
    assert.equal(jumpCalls, 1);
    assert.equal(writtenAnchor?.originPaneId, "%1");
    assert.equal(writtenAnchor?.originCwd, "/repo/marmonitor");
    assert.equal(writtenAnchor?.lastJumpTargetSessionId, "$target");
    assert.equal(writtenAnchor?.lastJumpTargetWindowId, "@2");
    assert.equal(writtenAnchor?.lastJumpTargetPaneId, "%2");
    assert.equal(writtenBriefing, undefined);
  });

  it("creates a keyboard jump briefing only after a successful jump", async () => {
    let writtenBriefing;

    await jumpToAgentWithAnchor(
      {
        pid: 42,
        cwd: "/marmonitor",
        agentName: "Codex",
        phase: "thinking",
        lastActivityAt: Math.floor(Date.now() / 1000) - 8,
      },
      { insideTmux: true, briefingSource: "keyboard" },
      {
        listTmuxClientIds: async () => [CURRENT_CLIENT.clientId],
        listTmuxPanes: async () => [],
        pruneJumpAnchors: async () => {},
        resolveTmuxClientLocation: async () => CURRENT_CLIENT,
        readJumpAnchor: async () => undefined,
        resolveTmuxJumpTarget: async () => ({
          pane: {
            target: "work:1.2",
            sessionName: "work",
            windowIndex: 1,
            paneIndex: 2,
            panePid: 101,
            cwd: "/repo/marmonitor",
          },
          match: "pid-tree",
        }),
        jumpToTmuxPane: async () => true,
        writeJumpBriefing: async (briefing) => {
          writtenBriefing = briefing;
        },
        writeJumpAnchor: async () => {},
      },
    );

    assert.match(writtenBriefing?.text ?? "", /^↪ Cx marmonitor · 🤔 · 8s$/);
    assert.equal(writtenBriefing?.reason, "keyboard");
    assert.equal(writtenBriefing?.clientId, CURRENT_CLIENT.clientId);
    assert.equal(
      (writtenBriefing?.expiresAt ?? 0) - (writtenBriefing?.createdAt ?? 0),
      JUMP_BRIEFING_TTL_MS,
    );
  });

  it("does not create a briefing for same-pane noop jumps", async () => {
    let briefingCalls = 0;

    const result = await jumpToAgentWithAnchor(
      {
        pid: 42,
        cwd: "/repo/marmonitor",
        agentName: "Codex",
        phase: "thinking",
      },
      { insideTmux: true, briefingSource: "keyboard" },
      {
        listTmuxClientIds: async () => [CURRENT_CLIENT.clientId],
        pruneJumpAnchors: async () => {},
        resolveTmuxClientLocation: async () => CURRENT_CLIENT,
        readJumpAnchor: async () => undefined,
        resolveTmuxJumpTarget: async () => ({
          pane: {
            target: "work:1.1",
            sessionName: "work",
            windowIndex: 1,
            paneIndex: 1,
            panePid: 100,
            cwd: "/repo/marmonitor",
          },
          match: "pid-tree",
        }),
        jumpToTmuxPane: async () => true,
        writeJumpBriefing: async () => {
          briefingCalls += 1;
        },
        writeJumpAnchor: async () => {},
      },
    );

    assert.equal(result.noop, true);
    assert.equal(briefingCalls, 0);
  });
});
