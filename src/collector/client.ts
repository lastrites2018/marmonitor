import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { MarmonitorConfig } from "../config/index.js";
import type { StatuslineFormat } from "../output/utils.js";
import type { AgentSession } from "../types.js";
import {
  collectorHealthMaxAgeMs,
  isCollectorHealthy,
  isCollectorHealthyForStatusline,
  matchesCollectorConfigPath,
} from "./model.js";
import {
  clearCollectorHealth,
  readCollectorHealth,
  readCollectorSnapshot,
  readCollectorStatusline,
  releaseCollectorRunLock,
} from "./store.js";

function resolveCliEntrypoint(): string {
  return process.argv[1] ?? "bin/marmonitor.js";
}

export async function readHealthyCollectorSnapshot(
  config: MarmonitorConfig,
  root = tmpdir(),
): Promise<AgentSession[] | undefined> {
  return await readHealthyCollectorSnapshotForRequest({
    config,
    root,
  });
}

export async function readHealthyCollectorSnapshotForRequest(params: {
  config: MarmonitorConfig;
  requestedConfigPath?: string;
  root?: string;
}): Promise<AgentSession[] | undefined> {
  const health = await readCollectorHealth(
    collectorHealthMaxAgeMs(params.config.performance.snapshotTtlMs),
    params.root,
  );
  if (!isCollectorHealthy(health?.value, params.config.performance.snapshotTtlMs)) {
    return undefined;
  }
  if (!matchesCollectorConfigPath(health?.value, params.requestedConfigPath)) {
    return undefined;
  }

  const snapshot = await readCollectorSnapshot(Number.MAX_SAFE_INTEGER, params.root);
  return snapshot?.value;
}

export async function readHealthyCollectorStatusline(params: {
  config: MarmonitorConfig;
  format: StatuslineFormat;
  attentionLimit: number;
  requestedConfigPath?: string;
  width?: number;
  root?: string;
}): Promise<string | undefined> {
  const health = await readCollectorHealth(
    collectorHealthMaxAgeMs(params.config.performance.statuslineTtlMs),
    params.root,
  );
  if (!isCollectorHealthy(health?.value, params.config.performance.statuslineTtlMs)) {
    return undefined;
  }
  if (!matchesCollectorConfigPath(health?.value, params.requestedConfigPath)) {
    return undefined;
  }

  const statusline = await readCollectorStatusline(
    params.format,
    params.attentionLimit,
    params.width,
    Number.MAX_SAFE_INTEGER,
    params.root,
  );
  return statusline?.value;
}

export async function readCurrentCollectorStatusline(params: {
  requestedConfigPath?: string;
  format: StatuslineFormat;
  width?: number;
  root?: string;
}): Promise<string | undefined> {
  const health = await readCollectorHealth(Number.MAX_SAFE_INTEGER, params.root);
  if (!isCollectorHealthyForStatusline(health?.value)) {
    return undefined;
  }
  if (!matchesCollectorConfigPath(health?.value, params.requestedConfigPath)) {
    return undefined;
  }
  const attentionLimit = health?.value?.statuslineAttentionLimit;
  if (!Number.isFinite(attentionLimit)) {
    return undefined;
  }
  const currentAttentionLimit = Number(attentionLimit);

  const statusline = await readCollectorStatusline(
    params.format,
    currentAttentionLimit,
    params.width,
    Number.MAX_SAFE_INTEGER,
    params.root,
  );
  return statusline?.value;
}

export async function startDetachedCollector(params: {
  configPath?: string;
  intervalSec?: number;
}): Promise<boolean> {
  const args = [
    resolveCliEntrypoint(),
    "collector",
    "run",
    "--foreground",
    ...(params.intervalSec ? ["--interval", String(params.intervalSec)] : []),
    ...(params.configPath ? ["--config", params.configPath] : []),
  ];

  try {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        MARMONITOR_COLLECTOR: "1",
      },
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function stopCollectorProcess(
  pid: number,
  root = tmpdir(),
): Promise<"stopped" | "missing"> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return "missing";
  }

  await releaseCollectorRunLock(root).catch(() => undefined);
  await clearCollectorHealth(root).catch(() => undefined);
  return "stopped";
}
