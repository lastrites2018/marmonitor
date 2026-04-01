import { spawn } from "node:child_process";
import { loadConfig, resolveConfigPath as resolveLoadedConfigPath } from "../config/index.js";
import { renderStatusline, renderUnavailableStatusline } from "../output/index.js";
import type { StatuslineFormat } from "../output/utils.js";
import { profileAsync } from "../perf.js";
import { acquireStatuslineRefreshLock, releaseStatuslineRefreshLock } from "../snapshot-cache.js";
import { getAgentsSnapshot } from "../snapshot/service.js";
import {
  readCollectorStatuslineForRequest,
  readHealthyCollectorSnapshotForRequest,
  startDetachedCollector,
} from "./client.js";
import { resolveStatuslineEntrypoint } from "./entrypoints.js";
import { decideStatuslineServe } from "./model.js";
import {
  readCachedSnapshotEntry,
  readCachedStatuslineEntry,
  writeCachedStatusline,
  writeCollectorStatusline,
} from "./store.js";

async function spawnStatuslineRefreshWorker(params: {
  format: StatuslineFormat;
  attentionLimit: number;
  width?: number;
  configPath?: string;
}): Promise<boolean> {
  const acquired = await profileAsync("cli", "acquireStatuslineRefreshLock", () =>
    acquireStatuslineRefreshLock(params.format, params.attentionLimit, params.width),
  );
  if (!acquired) return false;

  const args = [
    resolveStatuslineEntrypoint(),
    "--statusline",
    "--statusline-format",
    params.format,
    ...(params.width ? ["--width", String(params.width)] : []),
    ...(params.configPath ? ["--config", params.configPath] : []),
  ];

  try {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        MARMONITOR_STATUSLINE_WORKER: "1",
      },
    });
    child.unref();
    return true;
  } catch {
    await releaseStatuslineRefreshLock(params.format, params.attentionLimit, params.width);
    return false;
  }
}

export async function runStatuslineCommand(params: {
  format: StatuslineFormat;
  width?: number;
  configPath?: string;
}): Promise<string> {
  const isRefreshWorker = process.env.MARMONITOR_STATUSLINE_WORKER === "1";
  const requestedConfigPath = resolveLoadedConfigPath(params.configPath);
  let attentionLimit = 5;

  try {
    const collectorStatusline = await readCollectorStatuslineForRequest({
      requestedConfigPath,
      format: params.format,
      width: params.width,
    });
    if (collectorStatusline) {
      if (collectorStatusline.freshness === "stale" && !isRefreshWorker) {
        await spawnStatuslineRefreshWorker({
          format: params.format,
          attentionLimit: collectorStatusline.attentionLimit,
          width: params.width,
          configPath: params.configPath,
        });
      }
      return collectorStatusline.value;
    }

    const config = await loadConfig(requestedConfigPath);
    attentionLimit = config.display.statuslineAttentionLimit;
    const renderOptions = {
      tmuxBadgeStyle: config.integration.tmux.badgeStyle,
    } as const;
    const configAwareCollectorSnapshot = await readHealthyCollectorSnapshotForRequest({
      config,
      requestedConfigPath,
    });
    if (configAwareCollectorSnapshot) {
      const rendered = await renderStatusline(
        configAwareCollectorSnapshot,
        params.format,
        attentionLimit,
        params.width,
        renderOptions,
      );
      await writeCollectorStatusline(params.format, attentionLimit, params.width, rendered);
      return rendered;
    }
    if (!isRefreshWorker) {
      await startDetachedCollector({
        configPath: requestedConfigPath,
        intervalSec: Math.max(config.performance.snapshotTtlMs / 1000, 2),
      });
    }

    const statuslineCache = await readCachedStatuslineEntry(
      params.format,
      attentionLimit,
      params.width,
      config.performance.statuslineTtlMs,
    );
    const snapshotCache = await readCachedSnapshotEntry(
      "light",
      config.display.showDead,
      config.performance.snapshotTtlMs,
    );
    const decision = decideStatuslineServe({
      isRefreshWorker,
      statuslineTtlMs: config.performance.statuslineTtlMs,
      snapshotTtlMs: config.performance.snapshotTtlMs,
      statuslineCache,
      snapshotCache,
    });

    switch (decision.kind) {
      case "serve-statusline-cache":
        if (decision.refreshInBackground) {
          await spawnStatuslineRefreshWorker({
            format: params.format,
            attentionLimit,
            width: params.width,
            configPath: params.configPath,
          });
        }
        return decision.value;

      case "serve-snapshot-cache": {
        if (decision.refreshInBackground) {
          await spawnStatuslineRefreshWorker({
            format: params.format,
            attentionLimit,
            width: params.width,
            configPath: params.configPath,
          });
        }

        const rendered = await renderStatusline(
          decision.value,
          params.format,
          attentionLimit,
          params.width,
          renderOptions,
        );
        if (decision.freshness === "fresh") {
          await writeCachedStatusline(params.format, attentionLimit, params.width, rendered);
        }
        return rendered;
      }

      case "refresh-sync": {
        const agents = await getAgentsSnapshot(config, {
          enrichmentMode: "light",
          includeStdoutHeuristic: true,
          useSharedRuntimeSnapshots: true,
          seedSessions: snapshotCache?.value,
        });
        const rendered = await renderStatusline(
          agents,
          params.format,
          attentionLimit,
          params.width,
          renderOptions,
        );
        await writeCachedStatusline(params.format, attentionLimit, params.width, rendered);
        return rendered;
      }
    }
  } catch {
    return renderUnavailableStatusline(params.format);
  } finally {
    if (isRefreshWorker) {
      await releaseStatuslineRefreshLock(params.format, attentionLimit, params.width);
    }
  }

  return renderUnavailableStatusline(params.format);
}
