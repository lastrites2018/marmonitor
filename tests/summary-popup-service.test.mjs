import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadSummaryPopupAgents } from "../dist/summary-popup/service.js";

describe("summary popup service", () => {
  it("returns the collector snapshot when available", async () => {
    const collectorAgents = [{ pid: 10, agentName: "Codex", cwd: "/repo", status: "Active" }];
    const result = await loadSummaryPopupAgents(
      {
        config: { performance: { snapshotTtlMs: 10_000 } },
        requestedConfigPath: "/tmp/settings.json",
        collectorOnly: true,
      },
      {
        readCollectorSnapshot: async () => collectorAgents,
        getLiveSnapshot: async () => {
          throw new Error("live fallback should not run");
        },
      },
    );

    assert.equal(result.source, "collector");
    assert.deepEqual(result.agents, collectorAgents);
  });

  it("returns unavailable when collector-only is requested and no collector snapshot exists", async () => {
    const result = await loadSummaryPopupAgents(
      {
        config: { performance: { snapshotTtlMs: 10_000 } },
        requestedConfigPath: "/tmp/settings.json",
        collectorOnly: true,
      },
      {
        readCollectorSnapshot: async () => undefined,
        getLiveSnapshot: async () => {
          throw new Error("live fallback should not run");
        },
      },
    );

    assert.equal(result.source, "unavailable");
    assert.equal(result.agents, undefined);
  });

  it("falls back to a live snapshot when collector-only is disabled", async () => {
    const liveAgents = [{ pid: 20, agentName: "Claude Code", cwd: "/repo", status: "Idle" }];
    const result = await loadSummaryPopupAgents(
      {
        config: { performance: { snapshotTtlMs: 10_000 } },
        requestedConfigPath: "/tmp/settings.json",
        collectorOnly: false,
      },
      {
        readCollectorSnapshot: async () => undefined,
        getLiveSnapshot: async () => liveAgents,
      },
    );

    assert.equal(result.source, "live");
    assert.deepEqual(result.agents, liveAgents);
  });
});
