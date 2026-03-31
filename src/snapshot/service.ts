import { readCachedSnapshot, writeCachedSnapshot } from "../collector/store.js";
import type { MarmonitorConfig } from "../config/index.js";
import { profileAsync } from "../perf.js";
import { scanAgents } from "../scanner/index.js";
import { acquireSnapshotRefreshLock, releaseSnapshotRefreshLock } from "../snapshot-cache.js";
import type { AgentSession } from "../types.js";

const SNAPSHOT_LOCK_POLL_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SnapshotRequestContext = {
  enrichmentMode: "full" | "light";
  showDead: boolean;
  ttlMs: number;
  useCache: boolean;
};

export type SnapshotRequestOptions = {
  enrichmentMode?: "full" | "light";
  ttlMs?: number;
  includeTokenUsage?: boolean;
  includeStdoutHeuristic?: boolean;
  useSharedRuntimeSnapshots?: boolean;
  seedSessions?: AgentSession[];
};

async function readFreshSnapshotIfAvailable(
  context: SnapshotRequestContext,
): Promise<AgentSession[] | undefined> {
  if (!context.useCache) return undefined;
  return await readCachedSnapshot(context.enrichmentMode, context.showDead, context.ttlMs);
}

async function acquireSnapshotRefreshLockWithPolling(
  context: SnapshotRequestContext,
): Promise<boolean> {
  if (!context.useCache) return true;

  let acquired = false;
  let lockUnavailable = false;

  while (!acquired && !lockUnavailable) {
    const cached = await readFreshSnapshotIfAvailable(context);
    if (cached) return false;

    try {
      acquired = await profileAsync("snapshot", "acquireSnapshotRefreshLock", () =>
        acquireSnapshotRefreshLock(context.enrichmentMode, context.showDead),
      );
    } catch {
      lockUnavailable = true;
    }

    if (!acquired && !lockUnavailable) {
      await sleep(SNAPSHOT_LOCK_POLL_MS);
    }
  }

  return acquired;
}

async function scanAndPersistSnapshot(
  config: MarmonitorConfig,
  context: SnapshotRequestContext,
  options: SnapshotRequestOptions,
): Promise<AgentSession[]> {
  const agents = await profileAsync("snapshot", "scanAgents", () =>
    scanAgents(config, {
      enrichmentMode: context.enrichmentMode,
      includeTokenUsage: options.includeTokenUsage,
      includeStdoutHeuristic: options.includeStdoutHeuristic,
      useSharedRuntimeSnapshots: options.useSharedRuntimeSnapshots,
      seedSessions: options.seedSessions,
    }),
  );

  if (context.useCache) {
    await writeCachedSnapshot(context.enrichmentMode, context.showDead, agents);
  }

  return agents;
}

export async function getAgentsSnapshot(
  config: MarmonitorConfig,
  options: SnapshotRequestOptions = {},
): Promise<AgentSession[]> {
  const ttlMs = options.ttlMs ?? config.performance.snapshotTtlMs;
  const context: SnapshotRequestContext = {
    enrichmentMode: options.enrichmentMode ?? "full",
    showDead: config.display.showDead,
    ttlMs,
    useCache: ttlMs > 0,
  };

  return await profileAsync("snapshot", "getAgentsSnapshot", async () => {
    const cachedBeforeLock = await readFreshSnapshotIfAvailable(context);
    if (cachedBeforeLock) return cachedBeforeLock;

    const acquired = await acquireSnapshotRefreshLockWithPolling(context);

    try {
      const cachedAfterLock = await readFreshSnapshotIfAvailable(context);
      if (cachedAfterLock) return cachedAfterLock;

      return await scanAndPersistSnapshot(config, context, options);
    } finally {
      if (context.useCache && acquired) {
        await releaseSnapshotRefreshLock(context.enrichmentMode, context.showDead);
      }
    }
  });
}
