import type { Command } from "commander";
import { resolveConfigPath as resolveLoadedConfigPath } from "../config/index.js";
import { startDetachedCollector, stopCollectorProcess } from "./client.js";
import { DEFAULT_COLLECTOR_FORMATS, runCollectorLoop } from "./loop.js";
import {
  collectorHealthMaxAgeMs,
  isCollectorHealthy,
  matchesCollectorConfigPath,
} from "./model.js";
import { readCollectorHealth } from "./store.js";

function resolveIntervalMs(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) return 2_000;
  return Math.max(parsed * 1000, 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number | undefined): boolean {
  if (!Number.isFinite(pid) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

export function registerCollectorCommands(params: {
  program: Command;
  resolveConfigPath: (opts: { config?: string }) => string | undefined;
}): void {
  const collector = params.program.command("collector").description("Run or inspect the collector");

  collector
    .command("start")
    .description("Start the collector in the background")
    .option("--interval <sec>", "Refresh interval in seconds", "2")
    .option("--config <path>", "Path to settings.json")
    .action(async (opts) => {
      const ttlMs = resolveIntervalMs(opts.interval);
      const requestedConfigPath = resolveLoadedConfigPath(params.resolveConfigPath(opts));
      const existingHealth = await readCollectorHealth(collectorHealthMaxAgeMs(ttlMs));
      const existingPidAlive = isPidAlive(existingHealth?.value?.pid);
      if (
        existingPidAlive &&
        isCollectorHealthy(existingHealth?.value, ttlMs) &&
        matchesCollectorConfigPath(existingHealth?.value, requestedConfigPath)
      ) {
        console.log(`collector already running (pid ${existingHealth?.value?.pid})`);
        return;
      }
      if (existingPidAlive && isCollectorHealthy(existingHealth?.value, ttlMs)) {
        console.log(
          `collector already running with a different config (${existingHealth?.value?.configPath ?? "defaults"})`,
        );
        process.exit(1);
      }

      const started = await startDetachedCollector({
        configPath: requestedConfigPath,
        intervalSec: Number.parseFloat(opts.interval),
      });

      if (!started) {
        console.log("collector start failed");
        process.exit(1);
      }

      for (let attempt = 0; attempt < 20; attempt += 1) {
        await sleep(100);
        const health = await readCollectorHealth(collectorHealthMaxAgeMs(ttlMs));
        if (
          isCollectorHealthy(health?.value, ttlMs) &&
          matchesCollectorConfigPath(health?.value, requestedConfigPath)
        ) {
          console.log(`collector running (pid ${health?.value?.pid})`);
          return;
        }
      }

      console.log("collector start requested, but health did not appear in time");
      process.exit(1);
    });

  collector
    .command("run")
    .description("Run the light snapshot collector")
    .option("--foreground", "Run in the foreground (current behavior)")
    .option("--once", "Run one refresh cycle and exit")
    .option("--interval <sec>", "Refresh interval in seconds", "2")
    .option("--config <path>", "Path to settings.json")
    .action(async (opts) => {
      const requestedConfigPath = resolveLoadedConfigPath(params.resolveConfigPath(opts));
      await runCollectorLoop({
        intervalMs: resolveIntervalMs(opts.interval),
        once: Boolean(opts.once),
        formats: DEFAULT_COLLECTOR_FORMATS,
        configPath: requestedConfigPath,
      });
    });

  collector
    .command("status")
    .description("Show current collector health")
    .option("--json", "Output as JSON")
    .option("--ttl-ms <n>", "Healthy age window in milliseconds", "2000")
    .action(async (opts) => {
      const health = await readCollectorHealth(Number.MAX_SAFE_INTEGER);
      if (opts.json) {
        console.log(JSON.stringify(health?.value ?? null, null, 2));
        return;
      }

      if (!health?.value || !isPidAlive(health.value.pid)) {
        console.log("collector: not running");
        return;
      }

      const ttlMs = Number.parseInt(opts.ttlMs, 10);
      const healthy = isCollectorHealthy(health.value, ttlMs);

      console.log(`collector: ${health.value.state}`);
      console.log(`healthy: ${healthy ? "yes" : "no"}`);
      console.log(`pid: ${health.value.pid}`);
      console.log(`configPath: ${health.value.configPath ?? "(defaults)"}`);
      console.log(`startedAt: ${new Date(health.value.startedAt).toISOString()}`);
      console.log(`lastTickAt: ${new Date(health.value.lastTickAt).toISOString()}`);
      console.log(`healthyAgeMs: ${collectorHealthMaxAgeMs(ttlMs)}`);
      if (health.value.snapshotTtlMs) {
        console.log(`snapshotTtlMs: ${health.value.snapshotTtlMs}`);
      }
      if (health.value.statuslineTtlMs) {
        console.log(`statuslineTtlMs: ${health.value.statuslineTtlMs}`);
      }
      if (health.value.statuslineAttentionLimit) {
        console.log(`statuslineAttentionLimit: ${health.value.statuslineAttentionLimit}`);
      }
      if (health.value.lastSuccessAt) {
        console.log(`lastSuccessAt: ${new Date(health.value.lastSuccessAt).toISOString()}`);
      }
      if (health.value.snapshotGeneratedAt) {
        console.log(
          `snapshotGeneratedAt: ${new Date(health.value.snapshotGeneratedAt).toISOString()}`,
        );
      }
      if (health.value.lastErrorAt) {
        console.log(`lastErrorAt: ${new Date(health.value.lastErrorAt).toISOString()}`);
      }
      if (health.value.errorMessage) {
        console.log(`error: ${health.value.errorMessage}`);
      }
    });

  collector
    .command("stop")
    .description("Stop the running collector process")
    .action(async () => {
      const health = await readCollectorHealth(Number.MAX_SAFE_INTEGER);
      if (!health?.value) {
        console.log("collector: not running");
        return;
      }

      const result = await stopCollectorProcess(health.value.pid);
      console.log(
        result === "stopped"
          ? `collector stop signal sent to pid ${health.value.pid}`
          : `collector pid ${health.value.pid} is not running`,
      );
    });
}
