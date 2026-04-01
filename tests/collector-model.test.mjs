import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canServeStaleStatusline,
  collectorHealthMaxAgeMs,
  decideStatuslineServe,
  isCollectorHealthy,
  isCollectorHealthyForStatusline,
  matchesCollectorConfigPath,
  statuslineStaleMaxMs,
} from "../dist/collector/model.js";

describe("collector statusline serve policy", () => {
  it("prefers a fresh statusline cache over any snapshot cache", () => {
    const decision = decideStatuslineServe({
      isRefreshWorker: false,
      statuslineTtlMs: 10_000,
      snapshotTtlMs: 10_000,
      statuslineCache: { value: "cached-line", ageMs: 20, fresh: true },
      snapshotCache: { value: [{ pid: 1 }], ageMs: 10, fresh: true },
    });

    assert.deepEqual(decision, {
      kind: "serve-statusline-cache",
      value: "cached-line",
      freshness: "fresh",
      refreshInBackground: false,
    });
  });

  it("serves a stale statusline cache and refreshes in background for client requests", () => {
    const decision = decideStatuslineServe({
      isRefreshWorker: false,
      statuslineTtlMs: 10_000,
      snapshotTtlMs: 10_000,
      statuslineCache: { value: "stale-line", ageMs: 15_000, fresh: false },
    });

    assert.deepEqual(decision, {
      kind: "serve-statusline-cache",
      value: "stale-line",
      freshness: "stale",
      refreshInBackground: true,
    });
  });

  it("does not reuse stale caches inside the refresh worker", () => {
    const decision = decideStatuslineServe({
      isRefreshWorker: true,
      statuslineTtlMs: 10_000,
      snapshotTtlMs: 10_000,
      statuslineCache: { value: "stale-line", ageMs: 15_000, fresh: false },
      snapshotCache: { value: [{ pid: 2 }], ageMs: 18_000, fresh: false },
    });

    assert.deepEqual(decision, { kind: "refresh-sync" });
  });

  it("falls back to a fresh snapshot cache when no statusline cache is available", () => {
    const decision = decideStatuslineServe({
      isRefreshWorker: false,
      statuslineTtlMs: 10_000,
      snapshotTtlMs: 10_000,
      snapshotCache: { value: [{ pid: 3 }], ageMs: 30, fresh: true },
    });

    assert.deepEqual(decision, {
      kind: "serve-snapshot-cache",
      value: [{ pid: 3 }],
      freshness: "fresh",
      refreshInBackground: false,
    });
  });

  it("serves a stale snapshot cache and refreshes in background for client requests", () => {
    const decision = decideStatuslineServe({
      isRefreshWorker: false,
      statuslineTtlMs: 10_000,
      snapshotTtlMs: 10_000,
      snapshotCache: { value: [{ pid: 4 }], ageMs: 15_000, fresh: false },
    });

    assert.deepEqual(decision, {
      kind: "serve-snapshot-cache",
      value: [{ pid: 4 }],
      freshness: "stale",
      refreshInBackground: true,
    });
  });

  it("returns sync refresh when no reusable cache is available", () => {
    const decision = decideStatuslineServe({
      isRefreshWorker: false,
      statuslineTtlMs: 10_000,
      snapshotTtlMs: 10_000,
    });

    assert.deepEqual(decision, { kind: "refresh-sync" });
  });

  it("computes stale allowance from ttl and hard floor", () => {
    assert.equal(statuslineStaleMaxMs(5_000), 60_000);
    assert.equal(statuslineStaleMaxMs(20_000), 120_000);
    assert.equal(canServeStaleStatusline(59_999, 5_000), true);
    assert.equal(canServeStaleStatusline(60_001, 5_000), false);
  });

  it("treats collector health as healthy only when recent and snapshot-backed", () => {
    const now = Date.now();
    const health = {
      pid: 123,
      startedAt: now - 1_000,
      lastTickAt: now - 1_000,
      lastSuccessAt: now - 1_000,
      snapshotGeneratedAt: now - 1_000,
      state: "idle",
      version: "test",
      snapshotTtlMs: 2_000,
      statuslineTtlMs: 2_000,
      statuslineAttentionLimit: 5,
    };

    assert.equal(collectorHealthMaxAgeMs(2_000), 15_000);
    assert.equal(isCollectorHealthy(health, 2_000, now), true);
    assert.equal(
      isCollectorHealthy(
        {
          ...health,
          state: "degraded",
        },
        2_000,
        now,
      ),
      false,
    );
    assert.equal(
      isCollectorHealthy(
        {
          ...health,
          snapshotGeneratedAt: undefined,
        },
        2_000,
        now,
      ),
      false,
    );
    assert.equal(
      isCollectorHealthy(
        {
          ...health,
          lastTickAt: now - 20_000,
        },
        2_000,
        now,
      ),
      false,
    );
  });

  it("supports config-aware collector matching and statusline health", () => {
    const now = Date.now();
    const health = {
      pid: 123,
      startedAt: now - 1_000,
      lastTickAt: now - 1_000,
      lastSuccessAt: now - 1_000,
      snapshotGeneratedAt: now - 1_000,
      state: "idle",
      version: "test",
      configPath: "/tmp/settings.json",
      snapshotTtlMs: 4_000,
      statuslineTtlMs: 4_000,
      statuslineAttentionLimit: 5,
    };

    assert.equal(isCollectorHealthyForStatusline(health, now), true);
    assert.equal(matchesCollectorConfigPath(health, "/tmp/settings.json"), true);
    assert.equal(matchesCollectorConfigPath(health, "/tmp/other.json"), false);
  });
});
