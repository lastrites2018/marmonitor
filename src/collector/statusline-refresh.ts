import { spawn } from "node:child_process";
import type { StatuslineFormat } from "../output/utils.js";
import { profileAsync } from "../perf.js";
import { acquireStatuslineRefreshLock, releaseStatuslineRefreshLock } from "../snapshot-cache.js";
import { resolveStatuslineEntrypoint } from "./entrypoints.js";

export async function spawnStatuslineRefreshWorker(params: {
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
