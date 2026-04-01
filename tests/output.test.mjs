import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  renderStatusline,
  renderUnavailableStatusline,
  requiresSystemInfoForStatusline,
} from "../dist/output/index.js";

describe("renderUnavailableStatusline", () => {
  it("returns plain fallback for default formats", () => {
    assert.equal(renderUnavailableStatusline("compact"), "marmonitor unavailable");
    assert.equal(renderUnavailableStatusline("tmux-badges"), "marmonitor unavailable");
  });

  it("returns parseable fallback for wezterm pills", () => {
    assert.equal(
      renderUnavailableStatusline("wezterm-pills"),
      "focus\tmarmonitor unavailable\t#bac2de\t#313244",
    );
  });
});

describe("requiresSystemInfoForStatusline", () => {
  it("fetches system metrics only for text formats that render them", () => {
    assert.equal(requiresSystemInfoForStatusline("compact"), true);
    assert.equal(requiresSystemInfoForStatusline("standard"), true);
    assert.equal(requiresSystemInfoForStatusline("extended"), true);
    assert.equal(requiresSystemInfoForStatusline("tmux-badges"), false);
    assert.equal(requiresSystemInfoForStatusline("wezterm-pills"), false);
  });
});

describe("renderStatusline idle right rail", () => {
  const now = Math.floor(Date.now() / 1000);
  const agents = [
    {
      pid: 10,
      agentName: "Codex",
      cwd: "/Users/macrent/work/marmonitor",
      status: "Idle",
      lastActivityAt: now - 30,
      idleSince: now - 11 * 60,
      cpuPercent: 0,
      memoryMb: 100,
    },
    {
      pid: 11,
      agentName: "Claude Code",
      cwd: "/Users/macrent/work/roam-new",
      status: "Idle",
      lastActivityAt: now - 60,
      idleSince: now - 20 * 60,
      cpuPercent: 0,
      memoryMb: 100,
    },
    {
      pid: 12,
      agentName: "Codex",
      cwd: "/Users/macrent/work/fmbattle",
      status: "Active",
      phase: "thinking",
      lastActivityAt: now - 5,
      cpuPercent: 5,
      memoryMb: 100,
    },
  ];

  it("adds the idle right rail on wide tmux-badges widths", async () => {
    const text = await renderStatusline(agents, "tmux-badges", 5, 180, {
      tmuxBadgeStyle: "plain",
    });
    assert.match(
      text,
      /#\[range=user\|sum:idle]idle Cl1 Cx1#\[norange] \| #\[range=user\|pid:10]marmonitor 11m#\[norange] · #\[range=user\|pid:11]roam-new 20m#\[norange]$/,
    );
  });

  it("hides the idle right rail on narrow tmux-badges widths", async () => {
    const text = await renderStatusline(agents, "tmux-badges", 5, 80, {
      tmuxBadgeStyle: "plain",
    });
    assert.doesNotMatch(text, /\bidle\b/);
  });

  it("shows an empty idle marker when wide enough but there are no warm-idle candidates", async () => {
    const text = await renderStatusline(
      [
        {
          pid: 20,
          agentName: "Codex",
          cwd: "/Users/macrent/work/marmonitor",
          status: "Idle",
          lastActivityAt: now - 30,
          recentCompleteAt: now - 30,
          idleSince: now - 30,
          cpuPercent: 0,
          memoryMb: 100,
        },
        {
          pid: 21,
          agentName: "Claude Code",
          cwd: "/Users/macrent/work/roam-new",
          status: "Idle",
          lastActivityAt: now - 2 * 60 * 60,
          idleSince: now - 2 * 60 * 60,
          cpuPercent: 0,
          memoryMb: 100,
        },
        {
          pid: 22,
          agentName: "Codex",
          cwd: "/Users/macrent/work/fmbattle",
          status: "Idle",
          phase: "thinking",
          lastActivityAt: now - 11 * 60,
          idleSince: now - 11 * 60,
          cpuPercent: 0,
          memoryMb: 100,
        },
      ],
      "tmux-badges",
      5,
      180,
      {
        tmuxBadgeStyle: "plain",
      },
    );
    assert.match(text, /#\[range=user\|sum:idle]idle -#\[norange]$/);
  });

  it("keeps one recent-complete item visible on the left rail within its retention window", async () => {
    const text = await renderStatusline(
      [
        {
          pid: 30,
          agentName: "Claude Code",
          cwd: "/Users/macrent/work/allow",
          status: "Active",
          phase: "permission",
          lastActivityAt: now - 5,
          cpuPercent: 0,
          memoryMb: 100,
        },
        {
          pid: 31,
          agentName: "Codex",
          cwd: "/Users/macrent/work/think-a",
          status: "Active",
          phase: "thinking",
          lastActivityAt: now - 10,
          cpuPercent: 0,
          memoryMb: 100,
        },
        {
          pid: 32,
          agentName: "Codex",
          cwd: "/Users/macrent/work/think-b",
          status: "Active",
          phase: "thinking",
          lastActivityAt: now - 12,
          cpuPercent: 0,
          memoryMb: 100,
        },
        {
          pid: 33,
          agentName: "Claude Code",
          cwd: "/Users/macrent/work/tool-a",
          status: "Active",
          phase: "tool",
          lastActivityAt: now - 14,
          cpuPercent: 0,
          memoryMb: 100,
        },
        {
          pid: 34,
          agentName: "Codex",
          cwd: "/Users/macrent/work/tool-b",
          status: "Active",
          phase: "tool",
          lastActivityAt: now - 16,
          cpuPercent: 0,
          memoryMb: 100,
        },
        {
          pid: 35,
          agentName: "Claude Code",
          cwd: "/Users/macrent/work/recent-complete",
          status: "Idle",
          lastActivityAt: now - 20,
          recentCompleteAt: now - 20,
          idleSince: now - 20,
          cpuPercent: 0,
          memoryMb: 100,
        },
      ],
      "tmux-badges",
      5,
      220,
      {
        tmuxBadgeStyle: "plain",
      },
    );

    assert.match(text, /#\[range=user\|pid:35]5 ✅Cl recent-complete 20s#\[norange]/);
    assert.doesNotMatch(text, /#\[range=user\|pid:34]5 🔧Cx tool-b 16s#\[norange]/);
  });
});
