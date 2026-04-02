import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleTextWidth } from "../dist/output/utils.js";
import { buildJumpBriefingText } from "../dist/tmux/jump-briefing.js";

describe("jump briefing", () => {
  it("keeps the rendered briefing text within the visible width budget", () => {
    const text = buildJumpBriefingText(
      {
        agentName: "Codex",
        cwd: "/Users/test/very-long-parent-path-name/very-long-repository-name",
        phase: "thinking",
        lastActivityAt: Math.floor(Date.now() / 1000) - 8,
      },
      Math.floor(Date.now() / 1000),
    );

    assert.ok(text.startsWith("↪ Cx "));
    assert.ok(visibleTextWidth(text) <= 32);
    assert.ok(text.endsWith("…"));
  });
});
