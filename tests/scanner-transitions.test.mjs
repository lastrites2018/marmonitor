import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveSessionTransitionState } from "../dist/scanner/transitions.js";

describe("deriveSessionTransitionState", () => {
  it("records recent-complete and idleSince when a thinking session becomes idle", () => {
    const now = 1_700_000_500;
    const state = deriveSessionTransitionState(
      {
        status: "Idle",
        phase: undefined,
        lastActivityAt: now - 5,
      },
      {
        status: "Active",
        phase: "thinking",
      },
      now,
    );

    assert.equal(state.idleSince, now - 5);
    assert.equal(state.recentCompleteAt, now - 5);
  });

  it("keeps prior idle transition state across consecutive idle scans", () => {
    const now = 1_700_000_800;
    const state = deriveSessionTransitionState(
      {
        status: "Idle",
        phase: undefined,
        lastActivityAt: now - 30,
      },
      {
        status: "Idle",
        idleSince: now - 600,
        recentCompleteAt: now - 120,
      },
      now,
    );

    assert.equal(state.idleSince, now - 600);
    assert.equal(state.recentCompleteAt, now - 120);
  });

  it("does not infer recent-complete without a preceding thinking/tool phase", () => {
    const now = 1_700_001_000;
    const state = deriveSessionTransitionState(
      {
        status: "Idle",
        phase: undefined,
        lastActivityAt: now - 10,
      },
      {
        status: "Active",
        phase: "permission",
      },
      now,
    );

    assert.equal(state.idleSince, now - 10);
    assert.equal(state.recentCompleteAt, undefined);
  });

  it("clears idle transition state once the session is active again", () => {
    const now = 1_700_001_200;
    const state = deriveSessionTransitionState(
      {
        status: "Active",
        phase: "tool",
        lastActivityAt: now - 3,
      },
      {
        status: "Idle",
        idleSince: now - 300,
        recentCompleteAt: now - 240,
      },
      now,
    );

    assert.equal(state.idleSince, undefined);
    assert.equal(state.recentCompleteAt, undefined);
  });
});
