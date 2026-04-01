#!/usr/bin/env node

import { execFile } from "node:child_process";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { parseArgs, promisify } from "node:util";

const execFileAsync = promisify(execFile);

function percentile(sortedValues, ratio) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.round((sortedValues.length - 1) * ratio)),
  );
  return sortedValues[index];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  const averageMs = total / samples.length;
  return {
    runs: samples.length,
    minMs: Number(sorted[0].toFixed(1)),
    p50Ms: Number(percentile(sorted, 0.5).toFixed(1)),
    p95Ms: Number(percentile(sorted, 0.95).toFixed(1)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(1)),
    averageMs: Number(averageMs.toFixed(1)),
    samplesMs: samples.map((value) => Number(value.toFixed(1))),
  };
}

async function getGitCommit(revision) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", revision], { encoding: "utf8" });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function parsePerfBlocks(stderr) {
  const blocks = [];
  for (const line of stderr.split("\n")) {
    if (!line.startsWith("MARMONITOR_PERF ")) continue;
    try {
      blocks.push(JSON.parse(line.slice("MARMONITOR_PERF ".length)));
    } catch {
      // ignore malformed perf lines
    }
  }
  return blocks;
}

function getPerfStepTotal(perfBlocks, label, step) {
  const block = perfBlocks.find((entry) => entry.label === label);
  const perfStep = block?.steps?.find((entry) => entry.step === step);
  return typeof perfStep?.totalMs === "number" ? perfStep.totalMs : undefined;
}

function parseStatusOutput(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    const agents = Array.isArray(parsed?.agents) ? parsed.agents : [];
    const codexAgents = agents.filter((agent) => agent?.agent === "Codex");
    return {
      agentCount: agents.length,
      codexAgentCount: codexAgents.length,
    };
  } catch {
    return {
      agentCount: undefined,
      codexAgentCount: undefined,
    };
  }
}

function printHumanSummary(result) {
  console.log("Codex live benchmark");
  console.log(`command: ${result.command.join(" ")}`);
  console.log(`commit: ${result.environment.currentCommit ?? "(unknown)"}`);
  if (result.environment.baselineCommit) {
    console.log(`baseline: ${result.environment.baselineCommit}`);
  }
  console.log(
    `host: ${result.environment.cpuModel} | ${result.environment.logicalCpuCount} logical CPU | ${result.environment.totalMemoryGb} GB RAM`,
  );
  if (typeof result.environment.agentCount === "number") {
    console.log(
      `agents: ${result.environment.agentCount} total | codex=${result.environment.codexAgentCount ?? 0}`,
    );
  }
  console.log(`repeats: ${result.repeats}`);
  console.log("");
  console.log(`status total: ${result.metrics.statusTotal.averageMs}ms avg`);
  console.log(`scanAgents.codex_index: ${result.metrics.codexDiscovery.averageMs}ms avg`);
  console.log(`codex.indexCodexSessions: ${result.metrics.codexIndex.averageMs}ms avg`);
  console.log(`codex.detectCodexPhase: ${result.metrics.codexPhase.averageMs}ms avg`);
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      repeats: { type: "string", default: "1" },
      json: { type: "boolean", default: false },
      config: { type: "string" },
      "baseline-ref": { type: "string", default: "origin/main" },
    },
    allowPositionals: false,
  });

  const repeats = Number(values.repeats);
  if (!Number.isInteger(repeats) || repeats <= 0) {
    throw new Error(`Invalid --repeats value: ${values.repeats}`);
  }

  const command = ["bin/marmonitor.js", "status", "--json"];
  if (typeof values.config === "string" && values.config.length > 0) {
    command.push("--config", values.config);
  }

  const statusSamples = [];
  const codexDiscoverySamples = [];
  const codexIndexSamples = [];
  const codexPhaseSamples = [];
  let agentCount;
  let codexAgentCount;

  for (let index = 0; index < repeats; index += 1) {
    const startedAt = performance.now();
    const { stdout, stderr } = await execFileAsync("node", command, {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MARMONITOR_PERF: "1",
      },
      maxBuffer: 32 * 1024 * 1024,
    });
    statusSamples.push(performance.now() - startedAt);

    const perfBlocks = parsePerfBlocks(stderr);
    codexDiscoverySamples.push(getPerfStepTotal(perfBlocks, "scanAgents", "codex_index") ?? 0);
    codexIndexSamples.push(getPerfStepTotal(perfBlocks, "codex", "indexCodexSessions") ?? 0);
    codexPhaseSamples.push(getPerfStepTotal(perfBlocks, "codex", "detectCodexPhase") ?? 0);

    const parsedStatus = parseStatusOutput(stdout);
    agentCount = parsedStatus.agentCount;
    codexAgentCount = parsedStatus.codexAgentCount;
  }

  const result = {
    environment: {
      currentCommit: await getGitCommit("HEAD"),
      baselineCommit: await getGitCommit(String(values["baseline-ref"])),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuModel: os.cpus()[0]?.model ?? "(unknown)",
      logicalCpuCount: os.cpus().length,
      totalMemoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      agentCount,
      codexAgentCount,
    },
    command,
    repeats,
    metrics: {
      statusTotal: summarize(statusSamples),
      codexDiscovery: summarize(codexDiscoverySamples),
      codexIndex: summarize(codexIndexSamples),
      codexPhase: summarize(codexPhaseSamples),
    },
  };

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printHumanSummary(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
