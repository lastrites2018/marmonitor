import type { AgentSession } from "../types.js";

export const STATUSLINE_STALE_FALLBACK_MS = 60_000;
export const COLLECTOR_HEALTH_STALE_FALLBACK_MS = 15_000;

export type CachedArtifact<T> = {
  value: T;
  ageMs: number;
  fresh: boolean;
};

export type CollectorState = "starting" | "refreshing" | "idle" | "degraded";

export interface CollectorHealth {
  pid: number;
  startedAt: number;
  lastTickAt: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  state: CollectorState;
  version: string;
  snapshotGeneratedAt?: number;
  errorMessage?: string;
  configPath?: string;
  snapshotTtlMs?: number;
  statuslineTtlMs?: number;
  statuslineAttentionLimit?: number;
}

export type StatuslineServeDecision =
  | {
      kind: "serve-statusline-cache";
      value: string;
      freshness: "fresh" | "stale";
      refreshInBackground: boolean;
    }
  | {
      kind: "serve-snapshot-cache";
      value: AgentSession[];
      freshness: "fresh" | "stale";
      refreshInBackground: boolean;
    }
  | {
      kind: "refresh-sync";
    };

export function statuslineStaleMaxMs(ttlMs: number): number {
  return Math.max(STATUSLINE_STALE_FALLBACK_MS, ttlMs * 6);
}

export function canServeStaleStatusline(ageMs: number, ttlMs: number): boolean {
  return ageMs <= statuslineStaleMaxMs(ttlMs);
}

export function collectorHealthMaxAgeMs(ttlMs: number): number {
  return Math.max(COLLECTOR_HEALTH_STALE_FALLBACK_MS, ttlMs * 3);
}

export function isCollectorHealthy(
  health: CollectorHealth | undefined,
  ttlMs: number,
  now = Date.now(),
): boolean {
  if (!health) return false;
  if (health.state === "degraded") return false;
  if (!health.snapshotGeneratedAt) return false;
  return now - health.lastTickAt <= collectorHealthMaxAgeMs(ttlMs);
}

export function isCollectorHealthyForSnapshot(
  health: CollectorHealth | undefined,
  now = Date.now(),
): boolean {
  if (!health || !Number.isFinite(health.snapshotTtlMs)) return false;
  const ttlMs = health.snapshotTtlMs;
  if (ttlMs === undefined) return false;
  return isCollectorHealthy(health, ttlMs, now);
}

export function isCollectorHealthyForStatusline(
  health: CollectorHealth | undefined,
  now = Date.now(),
): boolean {
  if (!health || !Number.isFinite(health.statuslineTtlMs)) return false;
  const ttlMs = health.statuslineTtlMs;
  if (ttlMs === undefined) return false;
  return isCollectorHealthy(health, ttlMs, now);
}

export function matchesCollectorConfigPath(
  health: CollectorHealth | undefined,
  requestedConfigPath: string | undefined,
): boolean {
  if (!health) return false;
  return (health.configPath ?? undefined) === requestedConfigPath;
}

export function decideStatuslineServe(params: {
  isRefreshWorker: boolean;
  statuslineTtlMs: number;
  snapshotTtlMs: number;
  statuslineCache?: CachedArtifact<string>;
  snapshotCache?: CachedArtifact<AgentSession[]>;
}): StatuslineServeDecision {
  const { isRefreshWorker, statuslineTtlMs, snapshotTtlMs, statuslineCache, snapshotCache } =
    params;

  if (statuslineCache?.fresh) {
    return {
      kind: "serve-statusline-cache",
      value: statuslineCache.value,
      freshness: "fresh",
      refreshInBackground: false,
    };
  }

  if (
    !isRefreshWorker &&
    statuslineCache &&
    canServeStaleStatusline(statuslineCache.ageMs, statuslineTtlMs)
  ) {
    return {
      kind: "serve-statusline-cache",
      value: statuslineCache.value,
      freshness: "stale",
      refreshInBackground: true,
    };
  }

  if (snapshotCache?.fresh) {
    return {
      kind: "serve-snapshot-cache",
      value: snapshotCache.value,
      freshness: "fresh",
      refreshInBackground: false,
    };
  }

  if (
    !isRefreshWorker &&
    snapshotCache &&
    canServeStaleStatusline(snapshotCache.ageMs, snapshotTtlMs)
  ) {
    return {
      kind: "serve-snapshot-cache",
      value: snapshotCache.value,
      freshness: "stale",
      refreshInBackground: true,
    };
  }

  return { kind: "refresh-sync" };
}
