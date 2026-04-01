import { renderStatusline } from "../output/index.js";
import type { StatuslineFormat } from "../output/utils.js";
import { scanAgents } from "../scanner/index.js";
import { VERSION } from "../version.js";
import type { CollectorHealth } from "./model.js";
import { loadCollectorRuntime } from "./runtime.js";
import {
  acquireCollectorRunLock,
  readCollectorHealth,
  readCollectorSnapshot,
  refreshCollectorRunLock,
  releaseCollectorRunLock,
  writeCachedStatusline,
  writeCollectorHealth,
  writeCollectorSnapshot,
  writeCollectorStatusline,
} from "./store.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type CollectorLoopOptions = {
  intervalMs: number;
  once?: boolean;
  formats?: StatuslineFormat[];
  width?: number;
  configPath?: string;
};

export const DEFAULT_COLLECTOR_FORMATS: StatuslineFormat[] = [
  "compact",
  "standard",
  "extended",
  "tmux-badges",
];
export const TRANSITION_SEED_MAX_AGE_MS = 60 * 60 * 1000;

export function selectTransitionSeedSessions(
  freshSnapshot: { value: Awaited<ReturnType<typeof scanAgents>> } | undefined,
  staleSnapshot:
    | {
        value: Awaited<ReturnType<typeof scanAgents>>;
        ageMs: number;
      }
    | undefined,
  maxAgeMs = TRANSITION_SEED_MAX_AGE_MS,
): Awaited<ReturnType<typeof scanAgents>> | undefined {
  if (freshSnapshot?.value?.length) return freshSnapshot.value;
  if (!staleSnapshot?.value?.length) return undefined;
  if (staleSnapshot.ageMs > maxAgeMs) return undefined;
  return staleSnapshot.value;
}

async function writeRenderedStatuslines(
  snapshot: Awaited<ReturnType<typeof scanAgents>>,
  formats: StatuslineFormat[],
  attentionLimit: number,
  width: number | undefined,
  tmuxBadgeStyle: "plain" | "minimal" | "pill",
): Promise<void> {
  for (const format of formats) {
    const rendered = await renderStatusline(snapshot, format, attentionLimit, width, {
      tmuxBadgeStyle,
    });
    await writeCollectorStatusline(format, attentionLimit, width, rendered);
    await writeCachedStatusline(format, attentionLimit, width, rendered);
  }
}

async function refreshCollectorArtifacts(
  runtime: Awaited<ReturnType<typeof loadCollectorRuntime>>,
  options: CollectorLoopOptions,
  startedAt: number,
): Promise<number> {
  const previousSnapshot = await readCollectorSnapshot(runtime.config.performance.snapshotTtlMs);
  const transitionSeedSnapshot = selectTransitionSeedSessions(
    previousSnapshot,
    previousSnapshot?.fresh
      ? previousSnapshot
      : await readCollectorSnapshot(Number.MAX_SAFE_INTEGER),
  );
  const snapshot = await scanAgents(runtime.config, {
    enrichmentMode: "light",
    includeStdoutHeuristic: true,
    useSharedRuntimeSnapshots: true,
    seedSessions: previousSnapshot?.value,
    seedTransitionSessions: transitionSeedSnapshot,
  });

  await writeCollectorSnapshot(snapshot);
  await writeRenderedStatuslines(
    snapshot,
    options.formats ?? DEFAULT_COLLECTOR_FORMATS,
    runtime.config.display.statuslineAttentionLimit,
    options.width,
    runtime.config.integration.tmux.badgeStyle,
  );
  const completedAt = Date.now();
  await writeCollectorHealth({
    pid: process.pid,
    startedAt,
    lastTickAt: completedAt,
    state: "idle",
    version: VERSION,
    lastSuccessAt: completedAt,
    snapshotGeneratedAt: completedAt,
    configPath: runtime.resolvedConfigPath,
    snapshotTtlMs: runtime.config.performance.snapshotTtlMs,
    statuslineTtlMs: runtime.config.performance.statuslineTtlMs,
    statuslineAttentionLimit: runtime.config.display.statuslineAttentionLimit,
  });
  return completedAt;
}

export async function runCollectorLoop(options: CollectorLoopOptions): Promise<void> {
  const acquired = await acquireCollectorRunLock();
  if (!acquired) {
    throw new Error("collector is already running");
  }

  const startedAt = Date.now();
  const initialRuntime = await loadCollectorRuntime(options.configPath);
  const existingHealth = await readCollectorHealth(Number.MAX_SAFE_INTEGER);
  let lastSuccessfulHealth =
    existingHealth?.value?.snapshotGeneratedAt !== undefined
      ? {
          lastSuccessAt:
            existingHealth.value.lastSuccessAt ?? existingHealth.value.snapshotGeneratedAt,
          snapshotGeneratedAt: existingHealth.value.snapshotGeneratedAt,
        }
      : undefined;
  try {
    await writeCollectorHealth({
      pid: process.pid,
      startedAt,
      lastTickAt: startedAt,
      lastSuccessAt: lastSuccessfulHealth?.lastSuccessAt,
      state: "starting",
      version: VERSION,
      snapshotGeneratedAt: lastSuccessfulHealth?.snapshotGeneratedAt,
      configPath: initialRuntime.resolvedConfigPath,
      snapshotTtlMs: initialRuntime.config.performance.snapshotTtlMs,
      statuslineTtlMs: initialRuntime.config.performance.statuslineTtlMs,
      statuslineAttentionLimit: initialRuntime.config.display.statuslineAttentionLimit,
    });

    let keepRunning = true;
    while (keepRunning) {
      try {
        const refreshingAt = Date.now();
        const runtime = await loadCollectorRuntime(options.configPath);
        await refreshCollectorRunLock();
        await writeCollectorHealth({
          pid: process.pid,
          startedAt,
          lastTickAt: refreshingAt,
          lastSuccessAt: lastSuccessfulHealth?.lastSuccessAt,
          state: "refreshing",
          version: VERSION,
          snapshotGeneratedAt: lastSuccessfulHealth?.snapshotGeneratedAt,
          configPath: runtime.resolvedConfigPath,
          snapshotTtlMs: runtime.config.performance.snapshotTtlMs,
          statuslineTtlMs: runtime.config.performance.statuslineTtlMs,
          statuslineAttentionLimit: runtime.config.display.statuslineAttentionLimit,
        });
        const completedAt = await refreshCollectorArtifacts(runtime, options, startedAt);
        lastSuccessfulHealth = {
          lastSuccessAt: completedAt,
          snapshotGeneratedAt: completedAt,
        };
        await refreshCollectorRunLock();
      } catch (error) {
        await writeCollectorHealth({
          pid: process.pid,
          startedAt,
          lastTickAt: Date.now(),
          lastSuccessAt: lastSuccessfulHealth?.lastSuccessAt,
          lastErrorAt: Date.now(),
          state: "degraded",
          version: VERSION,
          snapshotGeneratedAt: lastSuccessfulHealth?.snapshotGeneratedAt,
          errorMessage: error instanceof Error ? error.message : String(error),
          configPath: initialRuntime.resolvedConfigPath,
          snapshotTtlMs: initialRuntime.config.performance.snapshotTtlMs,
          statuslineTtlMs: initialRuntime.config.performance.statuslineTtlMs,
          statuslineAttentionLimit: initialRuntime.config.display.statuslineAttentionLimit,
        });
        throw error;
      }

      keepRunning = !options.once;
      if (keepRunning) {
        await sleep(options.intervalMs);
      }
    }
  } finally {
    await releaseCollectorRunLock();
  }
}
