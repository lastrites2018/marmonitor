import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TRANSITION_SEED_MAX_AGE_MS,
  selectTransitionSeedSessions,
} from "../dist/collector/loop.js";

describe("collector transition seed restoration", () => {
  it("prefers the fresh snapshot when it exists", () => {
    const fresh = {
      value: [{ pid: 1, agentName: "Codex", cwd: "/repo", status: "Idle" }],
    };
    const stale = {
      value: [{ pid: 2, agentName: "Claude Code", cwd: "/old", status: "Idle" }],
      ageMs: 5_000,
    };

    assert.equal(selectTransitionSeedSessions(fresh, stale), fresh.value);
  });

  it("reuses a recent stale snapshot only for transition seeds", () => {
    const stale = {
      value: [{ pid: 2, agentName: "Claude Code", cwd: "/old", status: "Idle" }],
      ageMs: 5 * 60 * 1000,
    };

    assert.equal(selectTransitionSeedSessions(undefined, stale), stale.value);
  });

  it("ignores transition seeds that are older than the bounded restoration window", () => {
    const stale = {
      value: [{ pid: 2, agentName: "Claude Code", cwd: "/old", status: "Idle" }],
      ageMs: TRANSITION_SEED_MAX_AGE_MS + 1,
    };

    assert.equal(selectTransitionSeedSessions(undefined, stale), undefined);
  });
});
