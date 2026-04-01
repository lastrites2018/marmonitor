import { execFileSync } from "node:child_process";
import { readHealthyCollectorSnapshotForRequest } from "./collector/client.js";
import { resolveCliEntrypoint } from "./collector/entrypoints.js";
import { loadConfig, resolveConfigPath } from "./config/index.js";
import { getAgentsSnapshot } from "./snapshot/service.js";
import { type SummaryPopupTarget, parseSummaryRange } from "./summary-popup/shared.js";
import { jumpBackForClient, jumpToAgentWithAnchor } from "./tmux/navigation.js";
import type { AgentSession } from "./types.js";

export function extractPidFromStatusRange(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^pid:(\d+)$/.exec(value.trim());
  return match?.[1];
}

export type StatusClickTarget =
  | { kind: "back" }
  | { kind: "pid"; pid: number }
  | { kind: "summary"; target: SummaryPopupTarget };

export function parseStatusClickTarget(value: string | undefined): StatusClickTarget | undefined {
  if (value?.trim() === "back") {
    return { kind: "back" };
  }

  const pid = extractPidFromStatusRange(value);
  if (pid) {
    const parsed = Number.parseInt(pid, 10);
    return Number.isFinite(parsed) ? { kind: "pid", pid: parsed } : undefined;
  }

  const summaryTarget = parseSummaryRange(value);
  if (summaryTarget) {
    return { kind: "summary", target: summaryTarget };
  }

  return undefined;
}

export function parseStatusClickArgs(args: string[]): {
  target?: StatusClickTarget;
  configPath?: string;
  targetClient?: string;
} {
  const directRange = args[0];
  let configPath: string | undefined;
  let targetClient: string | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--config") {
      const value = args[index + 1];
      if (value) {
        configPath = value;
        index += 1;
      }
    }
    if (arg === "--client-tty" || arg === "--target-client") {
      const value = args[index + 1];
      if (value) {
        targetClient = value;
        index += 1;
      }
    }
  }

  return {
    target: parseStatusClickTarget(directRange),
    configPath,
    targetClient,
  };
}

export function findClickedAgent(sessions: AgentSession[], pid: number): AgentSession | undefined {
  return sessions.find((session) => session.pid === pid);
}

function refreshTmuxClient(targetClient?: string): void {
  const args = ["refresh-client", "-S"];
  if (targetClient) {
    args.push("-t", targetClient);
  }
  try {
    execFileSync("tmux", args, {
      stdio: "ignore",
      env: process.env,
    });
  } catch {
    // Ignore refresh failures; the jump result is the important side effect.
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildSummaryPopupTmuxArgs(
  target: SummaryPopupTarget,
  configPath?: string,
  targetClient?: string,
): string[] {
  const command = [
    process.execPath,
    resolveCliEntrypoint(),
    "popup",
    "--summary-target",
    target,
    "--interactive",
    "--collector-only",
    ...(configPath ? ["--config", configPath] : []),
    ...(targetClient ? ["--target-client", targetClient] : []),
  ]
    .map(shellQuote)
    .join(" ");

  const args = ["display-popup", "-E", "-w", "70%", "-h", "70%"];
  if (targetClient) {
    args.push("-c", targetClient);
  }
  args.push(command);
  return args;
}

function openSummaryPopup(
  target: SummaryPopupTarget,
  configPath?: string,
  targetClient?: string,
): boolean {
  const args = buildSummaryPopupTmuxArgs(target, configPath, targetClient);
  try {
    execFileSync("tmux", args, {
      stdio: "ignore",
      env: process.env,
    });
    return true;
  } catch {
    return false;
  }
}

export async function runStatusClick(args: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseStatusClickArgs(args);
  if (!options.target) return 0;

  if (options.target.kind === "back") {
    const result = await jumpBackForClient({
      targetClient: options.targetClient,
      insideTmux: true,
    });
    if (result.executed) {
      refreshTmuxClient(options.targetClient);
      return 0;
    }
    return 1;
  }

  if (options.target.kind === "summary") {
    return openSummaryPopup(options.target.target, options.configPath, options.targetClient)
      ? 0
      : 1;
  }

  const pid = options.target.pid;

  const requestedConfigPath = resolveConfigPath(options.configPath);
  const config = await loadConfig(requestedConfigPath);
  const sessions =
    (await readHealthyCollectorSnapshotForRequest({
      config,
      requestedConfigPath,
    })) ??
    (await getAgentsSnapshot(config, {
      enrichmentMode: "light",
      includeStdoutHeuristic: true,
      useSharedRuntimeSnapshots: true,
    }));
  const agent = findClickedAgent(sessions, pid);
  if (!agent) return 1;

  const result = await jumpToAgentWithAnchor(agent, {
    targetClient: options.targetClient,
    insideTmux: true,
  });
  if (result.executed) {
    refreshTmuxClient(options.targetClient);
    return 0;
  }
  return 1;
}

export async function main(): Promise<void> {
  process.exit(await runStatusClick());
}
