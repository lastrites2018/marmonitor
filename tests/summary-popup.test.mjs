import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSummaryPopupPage,
  buildSummaryPopupSections,
  selectSummaryPopupItem,
  selectSummaryPopupItems,
  summaryPopupTitle,
} from "../dist/summary-popup/model.js";
import { renderSummaryPopup, renderSummaryPopupPage } from "../dist/summary-popup/render.js";
import {
  parseSummaryPopupTarget,
  parseSummaryRange,
  serializeSummaryRange,
} from "../dist/summary-popup/shared.js";

describe("summary popup target parsing", () => {
  it("parses supported summary targets", () => {
    assert.equal(parseSummaryPopupTarget("agent:claude"), "agent:claude");
    assert.equal(parseSummaryPopupTarget("idle"), "idle");
    assert.equal(parseSummaryPopupTarget("phase:thinking"), "phase:thinking");
    assert.equal(parseSummaryPopupTarget("issue"), "issue");
    assert.equal(parseSummaryPopupTarget("unknown"), undefined);
  });

  it("parses summary status ranges", () => {
    assert.equal(parseSummaryRange("sum:codex"), "agent:codex");
    assert.equal(parseSummaryRange("sum:idle"), "idle");
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
      pid: 22,
      agentName: "Claude Code",
      cwd: "/repo/claude-idle",
      status: "Idle",
      lastActivityAt: nowSec - 40,
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
      [10, 22, 11],
    );
  });

  it("selects reusable idle Claude/Codex sessions for idle popup filters", () => {
    assert.deepEqual(
      selectSummaryPopupItems(agents, "idle", { nowSec }).map((agent) => agent.pid),
      [22],
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

  it("selects a popup item by 1-based index", () => {
    assert.equal(selectSummaryPopupItem(agents, "phase:thinking", 1, { nowSec })?.pid, 20);
    assert.equal(selectSummaryPopupItem(agents, "phase:thinking", 2, { nowSec }), undefined);
  });

  it("splits issue popup items into stalled and unmatched sections", () => {
    const sections = buildSummaryPopupSections(agents, "issue", { nowSec });
    assert.deepEqual(
      sections.map((section) => [section.key, section.items.map((agent) => agent.pid)]),
      [
        ["stalled", [11]],
        ["unmatched", [40]],
      ],
    );
  });

  it("builds paged popup selections in 10-item chunks", () => {
    const page = buildSummaryPopupPage(
      Array.from({ length: 12 }, (_, index) => ({
        pid: index + 1,
        agentName: "Codex",
        cwd: `/repo/${index + 1}`,
        status: "Active",
        lastActivityAt: nowSec - index,
      })),
      "agent:codex",
      2,
      { pageSize: 10, nowSec },
    );

    assert.equal(page.page, 2);
    assert.equal(page.totalPages, 2);
    assert.equal(page.startIndex, 10);
    assert.deepEqual(
      page.items.map((agent) => agent.pid),
      [11, 12],
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

  it("renders the idle popup title", () => {
    assert.equal(summaryPopupTitle("idle", 2), "Idle Sessions (2)");
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

    assert.match(text, /1\. Codex alpha\/marmonitor/);
    assert.match(text, /2\. Codex beta\/marmonitor/);
  });

  it("renders issue sections with continuous numbering", () => {
    const text = renderSummaryPopup(
      [
        {
          pid: 100,
          agentName: "Codex",
          cwd: "/Users/jaewankim/Desktop/stalled",
          status: "Stalled",
          lastActivityAt: Math.floor(Date.now() / 1000) - 5,
        },
        {
          pid: 101,
          agentName: "Claude Code",
          cwd: "/Users/jaewankim/Desktop/orphan",
          status: "Unmatched",
        },
      ],
      "issue",
    );

    assert.match(text, /^Issue Sessions \(2\)/);
    assert.match(text, /\n\nStalled \(1\)\n\n1\. ⚠ Codex stalled/);
    assert.match(text, /\n\nUnmatched \(1\)\n\n2\. ⚠ Claude orphan/);
  });

  it("renders a paged popup header and page-local numbering", () => {
    const text = renderSummaryPopupPage(
      Array.from({ length: 12 }, (_, index) => ({
        pid: index + 1,
        agentName: "Codex",
        cwd: `/Users/jaewankim/Desktop/repo-${index + 1}`,
        status: "Active",
        lastActivityAt: Math.floor(Date.now() / 1000) - index,
      })),
      "agent:codex",
      2,
      10,
    );

    assert.match(text, /^Codex Sessions \(12\) {2}\[Page 2\/2\]/);
    assert.match(text, /\nShowing 11-12 of 12\n/);
    assert.match(text, /\n\n1\. Codex repo-11/);
    assert.match(text, /\n\n2\. Codex repo-12/);
    assert.match(text, /\n\nControls: 1-2 {2}Enter=1 {2}n\/p page {2}q close$/);
  });

  it("renders issue page sections with local counts when a section is partially shown", () => {
    const text = renderSummaryPopupPage(
      [
        ...Array.from({ length: 11 }, (_, index) => ({
          pid: index + 1,
          agentName: "Codex",
          cwd: `/Users/jaewankim/Desktop/stalled-${index + 1}`,
          status: "Stalled",
          lastActivityAt: Math.floor(Date.now() / 1000) - index,
        })),
        {
          pid: 20,
          agentName: "Claude Code",
          cwd: "/Users/jaewankim/Desktop/orphan",
          status: "Unmatched",
        },
      ],
      "issue",
      2,
      10,
    );

    assert.match(text, /^Issue Sessions \(12\) {2}\[Page 2\/2\]/);
    assert.match(text, /\nShowing 11-12 of 12\n/);
    assert.match(text, /\n\nStalled \(1\/11\)\n\n1\. ⚠ Codex stalled-11/);
    assert.match(text, /\n\nUnmatched \(1\)\n\n2\. ⚠ Claude orphan/);
    assert.match(text, /\n\nControls: 1-2 {2}Enter=1 {2}n\/p page {2}q close$/);
  });
});
