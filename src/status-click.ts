import { execFileSync } from "node:child_process";
import { readHealthyCollectorSnapshotForRequest } from "./collector/client.js";
import { loadConfig, resolveConfigPath } from "./config/index.js";
import { getAgentsSnapshot } from "./snapshot/service.js";
import { jumpToAgent } from "./tmux/index.js";
import type { AgentSession } from "./types.js";

export function extractPidFromStatusRange(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^pid:(\d+)$/.exec(value.trim());
  return match?.[1];
}

export function parseStatusClickArgs(args: string[]): {
  pid?: string;
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
    pid: extractPidFromStatusRange(directRange),
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

export async function runStatusClick(args: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseStatusClickArgs(args);
  if (!options.pid) return 0;
  const pid = Number.parseInt(options.pid, 10);
  if (!Number.isFinite(pid)) return 0;

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

  const result = await jumpToAgent(agent, {
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
