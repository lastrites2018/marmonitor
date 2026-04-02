import { execFileSync } from "node:child_process";
import { readHealthyCollectorSnapshotForRequest } from "./collector/client.js";
import { resolveCliEntrypoint } from "./collector/entrypoints.js";
import { loadConfig, resolveConfigPath } from "./config/index.js";
import { getAgentsSnapshot } from "./snapshot/service.js";
import { type SummaryPopupSize, resolveSummaryPopupSize } from "./summary-popup/layout.js";
import { selectSummaryPopupItems } from "./summary-popup/model.js";
import { loadSummaryPopupAgents } from "./summary-popup/service.js";
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

export function buildSummaryEmptyMessage(target: SummaryPopupTarget): string {
  switch (target) {
    case "agent:claude":
      return "No Claude sessions.";
    case "agent:codex":
      return "No Codex sessions.";
    case "agent:gemini":
      return "No Gemini sessions.";
    case "idle":
      return "No idle sessions.";
    case "phase:permission":
      return "No approval-waiting sessions.";
    case "phase:thinking":
      return "No thinking sessions.";
    case "phase:tool":
      return "No tool sessions.";
    case "issue":
      return "Nothing to review right now.";
  }
}

export function buildTmuxDisplayMessageArgs(message: string, targetClient?: string): string[] {
  const args = ["display-message"];
  if (targetClient) {
    args.push("-c", targetClient);
  }
  args.push(message);
  return args;
}

export type SummaryClickAction = { kind: "popup" } | { kind: "message"; message: string };

export function buildSummaryPopupTmuxArgs(
  target: SummaryPopupTarget,
  configPath?: string,
  targetClient?: string,
  popupSize?: SummaryPopupSize,
): string[] {
  const command = [
    process.execPath,
    resolveCliEntrypoint(),
    "popup",
    "--summary-target",
    target,
    "--interactive",
    ...(configPath ? ["--config", configPath] : []),
    ...(targetClient ? ["--target-client", targetClient] : []),
  ]
    .map(shellQuote)
    .join(" ");

  const args = [
    "display-popup",
    "-E",
    "-w",
    popupSize ? String(popupSize.width) : "70%",
    "-h",
    popupSize ? String(popupSize.height) : "70%",
  ];
  if (targetClient) {
    args.push("-c", targetClient);
  }
  args.push(command);
  return args;
}

export function parseTmuxClientSize(raw: string | undefined): SummaryPopupSize | undefined {
  if (!raw) return undefined;
  const [widthText, heightText] = raw.trim().split("\t");
  const width = Number.parseInt(widthText ?? "", 10);
  const height = Number.parseInt(heightText ?? "", 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return resolveSummaryPopupSize(width, height);
}

function readTmuxClientSize(targetClient?: string): SummaryPopupSize | undefined {
  try {
    const args = ["display-message", "-p"];
    if (targetClient) {
      args.push("-c", targetClient);
    }
    args.push("#{client_width}\t#{client_height}");
    const output = execFileSync("tmux", args, {
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseTmuxClientSize(output);
  } catch {
    return undefined;
  }
}

function openSummaryPopup(
  target: SummaryPopupTarget,
  configPath?: string,
  targetClient?: string,
): boolean {
  const popupSize = readTmuxClientSize(targetClient);
  const args = buildSummaryPopupTmuxArgs(target, configPath, targetClient, popupSize);
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

function showTmuxDisplayMessage(message: string, targetClient?: string): void {
  const args = buildTmuxDisplayMessageArgs(message, targetClient);
  try {
    execFileSync("tmux", args, {
      stdio: "ignore",
      env: process.env,
    });
  } catch {
    // Ignore message delivery failures; no-op is acceptable for empty summaries.
  }
}

export async function resolveSummaryClickAction(
  target: SummaryPopupTarget,
  options: {
    configPath?: string;
    targetClient?: string;
  },
  deps: {
    resolveConfigPath?: typeof resolveConfigPath;
    loadConfig?: typeof loadConfig;
    loadSummaryPopupAgents?: typeof loadSummaryPopupAgents;
  } = {},
): Promise<SummaryClickAction> {
  const resolveConfigPathFn = deps.resolveConfigPath ?? resolveConfigPath;
  const loadConfigFn = deps.loadConfig ?? loadConfig;
  const loadSummaryPopupAgentsFn = deps.loadSummaryPopupAgents ?? loadSummaryPopupAgents;

  try {
    const requestedConfigPath = resolveConfigPathFn(options.configPath);
    const config = await loadConfigFn(requestedConfigPath);
    const loaded = await loadSummaryPopupAgentsFn({
      config,
      requestedConfigPath,
      collectorOnly: true,
    });
    if (loaded.agents) {
      const items = selectSummaryPopupItems(loaded.agents, target);
      if (items.length === 0) {
        return { kind: "message", message: buildSummaryEmptyMessage(target) };
      }
    }
  } catch {
    // Fall through to popup launch; the popup command has its own fallback handling.
  }

  return { kind: "popup" };
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
    const action = await resolveSummaryClickAction(options.target.target, {
      configPath: options.configPath,
      targetClient: options.targetClient,
    });
    if (action.kind === "message") {
      showTmuxDisplayMessage(action.message, options.targetClient);
      return 0;
    }
    if (openSummaryPopup(options.target.target, options.configPath, options.targetClient)) {
      return 0;
    }
    showTmuxDisplayMessage("Unable to open summary popup.", options.targetClient);
    return 0;
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
  if (result.executed || result.noop) {
    refreshTmuxClient(options.targetClient);
    return 0;
  }
  return 1;
}

export async function main(): Promise<void> {
  process.exit(await runStatusClick());
}
