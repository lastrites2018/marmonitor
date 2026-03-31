import type { MarmonitorConfig } from "../config/index.js";
import { renderStatusline } from "../output/index.js";
import type { StatuslineFormat } from "../output/utils.js";
import { scanAgents } from "../scanner/index.js";
import { VERSION } from "../version.js";
import type { CollectorHealth } from "./model.js";
import {
  acquireCollectorRunLock,
  readCollectorSnapshot,
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

async function writeRenderedStatuslines(
  snapshot: Awaited<ReturnType<typeof scanAgents>>,
  formats: StatuslineFormat[],
  attentionLimit: number,
  width: number | undefined,
): Promise<void> {
  for (const format of formats) {
    const rendered = await renderStatusline(snapshot, format, attentionLimit, width);
    await writeCollectorStatusline(format, attentionLimit, width, rendered);
    await writeCachedStatusline(format, attentionLimit, width, rendered);
  }
}

async function refreshCollectorArtifacts(
  config: MarmonitorConfig,
  options: CollectorLoopOptions,
  startedAt: number,
): Promise<void> {
  const previousSnapshot = await readCollectorSnapshot(config.performance.snapshotTtlMs);
  const snapshot = await scanAgents(config, {
    enrichmentMode: "light",
    includeStdoutHeuristic: true,
    useSharedRuntimeSnapshots: true,
    seedSessions: previousSnapshot?.value,
  });

  await writeCollectorSnapshot(snapshot);
  await writeRenderedStatuslines(
    snapshot,
    options.formats ?? DEFAULT_COLLECTOR_FORMATS,
    config.display.statuslineAttentionLimit,
    options.width,
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
    configPath: options.configPath,
    snapshotTtlMs: config.performance.snapshotTtlMs,
    statuslineTtlMs: config.performance.statuslineTtlMs,
    statuslineAttentionLimit: config.display.statuslineAttentionLimit,
  });
}

export async function runCollectorLoop(
  config: MarmonitorConfig,
  options: CollectorLoopOptions,
): Promise<void> {
  const acquired = await acquireCollectorRunLock();
  if (!acquired) {
    throw new Error("collector is already running");
  }

  const startedAt = Date.now();
  try {
    await writeCollectorHealth({
      pid: process.pid,
      startedAt,
      lastTickAt: startedAt,
      state: "starting",
      version: VERSION,
      configPath: options.configPath,
      snapshotTtlMs: config.performance.snapshotTtlMs,
      statuslineTtlMs: config.performance.statuslineTtlMs,
      statuslineAttentionLimit: config.display.statuslineAttentionLimit,
    });

    let keepRunning = true;
    while (keepRunning) {
      try {
        const refreshingAt = Date.now();
        await writeCollectorHealth({
          pid: process.pid,
          startedAt,
          lastTickAt: refreshingAt,
          lastSuccessAt: refreshingAt,
          state: "refreshing",
          version: VERSION,
          configPath: options.configPath,
          snapshotTtlMs: config.performance.snapshotTtlMs,
          statuslineTtlMs: config.performance.statuslineTtlMs,
          statuslineAttentionLimit: config.display.statuslineAttentionLimit,
        });
        await refreshCollectorArtifacts(config, options, startedAt);
      } catch (error) {
        await writeCollectorHealth({
          pid: process.pid,
          startedAt,
          lastTickAt: Date.now(),
          lastErrorAt: Date.now(),
          state: "degraded",
          version: VERSION,
          errorMessage: error instanceof Error ? error.message : String(error),
          configPath: options.configPath,
          snapshotTtlMs: config.performance.snapshotTtlMs,
          statuslineTtlMs: config.performance.statuslineTtlMs,
          statuslineAttentionLimit: config.display.statuslineAttentionLimit,
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
