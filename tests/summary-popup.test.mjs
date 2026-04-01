import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectSummaryPopupItems, summaryPopupTitle } from "../dist/summary-popup/model.js";
import { renderSummaryPopup } from "../dist/summary-popup/render.js";
import {
  parseSummaryPopupTarget,
  parseSummaryRange,
  serializeSummaryRange,
} from "../dist/summary-popup/shared.js";

describe("summary popup target parsing", () => {
  it("parses supported summary targets", () => {
    assert.equal(parseSummaryPopupTarget("agent:claude"), "agent:claude");
    assert.equal(parseSummaryPopupTarget("phase:thinking"), "phase:thinking");
    assert.equal(parseSummaryPopupTarget("issue"), "issue");
    assert.equal(parseSummaryPopupTarget("unknown"), undefined);
  });

  it("parses summary status ranges", () => {
    assert.equal(parseSummaryRange("sum:codex"), "agent:codex");
    assert.equal(parseSummaryRange("sum:think"), "phase:thinking");
    assert.equal(parseSummaryRange("sum:issue"), "issue");
    assert.equal(parseSummaryRange("summary:agent:codex"), "agent:codex");
    assert.equal(parseSummaryRange("summary:issue"), "issue");
    assert.equal(parseSummaryRange("pid:123"), undefined);
    assert.equal(serializeSummaryRange("phase:tool"), "sum:tool");
  });
});

describe("summary popup item selection", () => {
  const nowSec = 10_000;
  const agents = [
    {
      pid: 10,
      agentName: "Claude Code",
      cwd: "/repo/claude",
      status: "Active",
      phase: "permission",
      lastActivityAt: nowSec - 5,
    },
    {
      pid: 11,
      agentName: "Claude Code",
      cwd: "/repo/claude-stalled",
      status: "Stalled",
      lastActivityAt: nowSec - 600,
    },
    {
      pid: 20,
      agentName: "Codex",
      cwd: "/repo/codex-thinking",
      status: "Active",
      phase: "thinking",
      lastActivityAt: nowSec - 10,
    },
    {
      pid: 21,
      agentName: "Codex",
      cwd: "/repo/codex-stale-thinking",
      status: "Idle",
      phase: "thinking",
      lastActivityAt: nowSec - 60 * 60,
    },
    {
      pid: 30,
      agentName: "Gemini",
      cwd: "/repo/gemini-tool",
      status: "Active",
      phase: "tool",
      lastActivityAt: nowSec - 20,
    },
    {
      pid: 40,
      agentName: "Codex",
      cwd: "/repo/orphan",
      status: "Unmatched",
      runtimeSource: "cli",
    },
  ];

  it("selects alive sessions for agent filters and keeps stalled alive sessions", () => {
    assert.deepEqual(
      selectSummaryPopupItems(agents, "agent:claude", { nowSec }).map((agent) => agent.pid),
      [10, 11],
    );
  });

  it("selects only recent thinking/tool sessions using attention semantics", () => {
    assert.deepEqual(
      selectSummaryPopupItems(agents, "phase:thinking", { nowSec }).map((agent) => agent.pid),
      [20],
    );
    assert.deepEqual(
      selectSummaryPopupItems(agents, "phase:tool", { nowSec }).map((agent) => agent.pid),
      [30],
    );
  });

  it("selects stalled and unmatched sessions for issue filters", () => {
    assert.deepEqual(
      selectSummaryPopupItems(agents, "issue", { nowSec }).map((agent) => agent.pid),
      [11, 40],
    );
  });
});

describe("summary popup render", () => {
  it("renders a title and numbered session lines", () => {
    const text = renderSummaryPopup(
      [
        {
          pid: 53176,
          agentName: "Codex",
          cwd: "/Users/jaewankim/Desktop/jaewan-develop/marmonitor",
          status: "Active",
          phase: "thinking",
          lastActivityAt: Math.floor(Date.now() / 1000) - 12,
        },
      ],
      "phase:thinking",
    );

    assert.match(text, /^Thinking Sessions \(1\)/);
    assert.match(text, /1\. 🤔 Codex .*marmonitor/);
    assert.match(text, /PID: 53176/);
  });

  it("renders an empty-state message when no sessions match", () => {
    assert.equal(summaryPopupTitle("agent:gemini", 0), "Gemini Sessions (0)");
    const text = renderSummaryPopup([], "agent:gemini");
    assert.match(text, /^Gemini Sessions \(0\)\n\nNo matching sessions\.$/);
  });

  it("disambiguates duplicate repo names with parent context", () => {
    const text = renderSummaryPopup(
      [
        {
          pid: 100,
          agentName: "Codex",
          cwd: "/Users/jaewankim/Desktop/alpha/marmonitor",
          status: "Active",
          lastActivityAt: Math.floor(Date.now() / 1000) - 5,
        },
        {
          pid: 101,
          agentName: "Codex",
          cwd: "/Users/jaewankim/Desktop/beta/marmonitor",
          status: "Active",
          lastActivityAt: Math.floor(Date.now() / 1000) - 10,
        },
      ],
      "agent:codex",
    );

    assert.match(text, /1\. • Codex alpha\/marmonitor/);
    assert.match(text, /2\. • Codex beta\/marmonitor/);
  });
});
