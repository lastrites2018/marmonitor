import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UNMATCHED_STARTUP_GRACE_SEC, deriveUnmatchedReason } from "../dist/scanner/unmatched.js";

describe("deriveUnmatchedReason", () => {
  const nowSec = 10_000;

  it("prefers ambiguous matches over other unmatched reasons", () => {
    assert.equal(
      deriveUnmatchedReason({
        cwd: "/repo/app",
        startedAt: nowSec - 10,
        nowSec,
        sessionLookupAttempted: true,
        ambiguousMatch: true,
      }),
      "ambiguous_match",
    );
  });

  it("reports cwd_unknown when cwd resolution failed", () => {
    assert.equal(
      deriveUnmatchedReason({
        cwd: "unknown",
        startedAt: nowSec - 5,
        nowSec,
      }),
      "cwd_unknown",
    );
  });

  it("treats very recent unmatched sessions as startup_grace", () => {
    assert.equal(
      deriveUnmatchedReason({
        cwd: "/repo/app",
        startedAt: nowSec - (UNMATCHED_STARTUP_GRACE_SEC - 1),
        nowSec,
        sessionLookupAttempted: true,
      }),
      "startup_grace",
    );
  });

  it("falls back to session_file_missing after the startup grace window", () => {
    assert.equal(
      deriveUnmatchedReason({
        cwd: "/repo/app",
        startedAt: nowSec - (UNMATCHED_STARTUP_GRACE_SEC + 1),
        nowSec,
        sessionLookupAttempted: true,
      }),
      "session_file_missing",
    );
  });

  it("returns unknown when nothing more specific is known", () => {
    assert.equal(
      deriveUnmatchedReason({
        cwd: "/repo/app",
        nowSec,
      }),
      "unknown",
    );
  });
});
