import {
  readCollectorStatuslineForRequest,
  readCurrentCollectorSnapshotForRequest,
} from "./collector/client.js";
import { spawnStatuslineRefreshWorker } from "./collector/statusline-refresh.js";
import { resolveConfigPath } from "./config/index.js";
import { renderUnavailableStatusline } from "./output/unavailable.js";
import type { StatuslineFormat } from "./output/utils.js";
import { type TmuxJumpAnchor, findJumpAnchorByClientTty } from "./tmux/jump-anchor.js";

const VALID_FORMATS = new Set<StatuslineFormat>([
  "compact",
  "standard",
  "extended",
  "tmux-badges",
  "wezterm-pills",
]);

export type StatuslineClientOptions = {
  format: StatuslineFormat;
  width?: number;
  configPath?: string;
  clientTty?: string;
};

const TMUX_DETAIL_MARKER = "  #[range=user|pid:";
const TMUX_BACK_RANGE = "#[range=user|back]↩#[norange]";
const TMUX_IDLE_MARKER = "#[range=user|sum:idle]";
const TMUX_NORANGE = "#[norange]";

export function appendJumpBackIndicator(output: string, hasAnchor: boolean): string {
  if (!hasAnchor) return output;
  const idleIndex = output.indexOf(TMUX_IDLE_MARKER);
  const detailIndex = output.indexOf(TMUX_DETAIL_MARKER);

  if (idleIndex === -1) {
    if (detailIndex === -1) {
      return `${output}  ${TMUX_BACK_RANGE}`;
    }
    const summary = output.slice(0, detailIndex);
    const detail = output.slice(detailIndex);
    return `${summary}  ${TMUX_BACK_RANGE}${detail}`;
  }

  const beforeIdle = output.slice(0, idleIndex);
  const right = output.slice(idleIndex);
  const trimmedLeft = beforeIdle.trimEnd();
  const gap = beforeIdle.slice(trimmedLeft.length) || "  ";
  const rightWithBack = `${TMUX_BACK_RANGE}  ${right}`;

  if (detailIndex === -1 || detailIndex >= idleIndex) {
    return `${trimmedLeft}  ${TMUX_BACK_RANGE}${gap}${rightWithBack}`;
  }

  const detailRelativeIndex = trimmedLeft.indexOf(TMUX_DETAIL_MARKER);
  if (detailRelativeIndex === -1) {
    return `${trimmedLeft}  ${TMUX_BACK_RANGE}${gap}${rightWithBack}`;
  }
  const summary = trimmedLeft.slice(0, detailRelativeIndex);
  const detail = trimmedLeft.slice(detailRelativeIndex);
  const leftWithBack = `${summary}  ${TMUX_BACK_RANGE}${detail}`;
  return `${leftWithBack}${gap}${rightWithBack}`;
}

export function underlineTmuxPidRange(output: string, pid: number): string {
  const rangeStart = `#[range=user|pid:${pid}]`;
  const startIndex = output.indexOf(rangeStart);
  if (startIndex === -1) return output;
  const contentStart = startIndex + rangeStart.length;
  const contentEnd = output.indexOf(TMUX_NORANGE, contentStart);
  if (contentEnd === -1) return output;
  return `${output.slice(0, contentStart)}#[underscore]${output.slice(contentStart, contentEnd)}#[nounderscore]${output.slice(contentEnd)}`;
}

export function promoteTmuxPidRangeToBack(output: string, pid: number): string {
  const rangeStart = `#[range=user|pid:${pid}]`;
  const startIndex = output.indexOf(rangeStart);
  if (startIndex === -1) return output;
  const contentStart = startIndex + rangeStart.length;
  const contentEnd = output.indexOf(TMUX_NORANGE, contentStart);
  if (contentEnd === -1) return output;
  return `${output.slice(0, startIndex)}#[range=user|back]#[underscore]${output.slice(contentStart, contentEnd)}#[nounderscore]${output.slice(contentEnd)}`;
}

async function findOriginVisiblePid(params: {
  agents: Awaited<ReturnType<typeof readCurrentCollectorSnapshotForRequest>>;
  attentionLimit: number;
  width?: number;
  anchor: TmuxJumpAnchor;
}): Promise<number | undefined> {
  const { agents, attentionLimit, width, anchor } = params;
  if (!agents?.length || !anchor.originCwd) {
    return undefined;
  }
  const { buildStatuslineAttentionRepresentatives, buildStatuslineRealtimeView } = await import(
    "./output/utils.js"
  );
  const realtimeView = buildStatuslineRealtimeView(agents, {
    includeFocusItems: true,
    includeIdleSnapshot: true,
  });
  const focusMatches = buildStatuslineAttentionRepresentatives(
    realtimeView.jumpItems ?? [],
    attentionLimit,
    width,
    {
      suppressedRepoLabels: realtimeView.suppressedRepoLabels,
    },
  )
    .filter((item) => item.cwd === anchor.originCwd)
    .map((item) => item.pid);
  const idleMatches =
    realtimeView.idleSnapshot?.entries
      .filter((entry) => entry.cwd === anchor.originCwd)
      .map((entry) => entry.pid) ?? [];
  const visibleMatches = [...new Set([...focusMatches, ...idleMatches])];
  if (visibleMatches.length === 1) {
    return visibleMatches[0];
  }
  return undefined;
}

export function parseStatuslineClientArgs(args: string[]): StatuslineClientOptions {
  let format: StatuslineFormat = "compact";
  let width: number | undefined;
  let configPath: string | undefined;
  let clientTty: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--statusline") continue;
    if (arg === "--statusline-format") {
      const value = args[index + 1];
      if (value && VALID_FORMATS.has(value as StatuslineFormat)) {
        format = value as StatuslineFormat;
        index += 1;
      }
      continue;
    }
    if (arg === "--width") {
      const value = Number.parseInt(args[index + 1] ?? "", 10);
      if (Number.isFinite(value) && value > 0) {
        width = value;
        index += 1;
      }
      continue;
    }
    if (arg === "--config") {
      const value = args[index + 1];
      if (value) {
        configPath = value;
        index += 1;
      }
      continue;
    }
    if (arg === "--client-tty" || arg === "--target-client") {
      const value = args[index + 1];
      if (value) {
        clientTty = value;
        index += 1;
      }
    }
  }

  return {
    format,
    width,
    configPath,
    clientTty,
  };
}

async function readFastCollectorStatusline(options: StatuslineClientOptions): Promise<
  | {
      value: string;
      attentionLimit: number;
    }
  | undefined
> {
  const requestedConfigPath = resolveConfigPath(options.configPath);
  const collectorStatusline = await readCollectorStatuslineForRequest({
    requestedConfigPath,
    format: options.format,
    width: options.width,
  });
  if (!collectorStatusline) {
    return undefined;
  }
  if (collectorStatusline.freshness === "stale") {
    await spawnStatuslineRefreshWorker({
      format: options.format,
      attentionLimit: collectorStatusline.attentionLimit,
      width: options.width,
      configPath: options.configPath,
    });
  }
  return {
    value: collectorStatusline.value,
    attentionLimit: collectorStatusline.attentionLimit,
  };
}

export async function runStatuslineClient(args: string[] = process.argv.slice(2)): Promise<string> {
  const options = parseStatuslineClientArgs(args);
  try {
    const requestedConfigPath = resolveConfigPath(options.configPath);
    const fastCollectorStatusline = await readFastCollectorStatusline(options);
    let output = fastCollectorStatusline?.value;
    if (output === undefined) {
      const { runStatuslineCommand } = await import("./collector/statusline.js");
      output = await runStatuslineCommand(options);
    }
    if (options.format !== "tmux-badges" || !options.clientTty) {
      return output;
    }
    const anchor = await findJumpAnchorByClientTty(options.clientTty);
    output = appendJumpBackIndicator(output, Boolean(anchor));
    if (!anchor || !fastCollectorStatusline?.attentionLimit) {
      return output;
    }
    const agents = await readCurrentCollectorSnapshotForRequest({
      requestedConfigPath,
    });
    const originPid = await findOriginVisiblePid({
      agents,
      attentionLimit: fastCollectorStatusline.attentionLimit,
      width: options.width,
      anchor,
    });
    return originPid ? promoteTmuxPidRangeToBack(output, originPid) : output;
  } catch {
    return renderUnavailableStatusline(options.format);
  }
}

export async function main(): Promise<void> {
  const output = await runStatuslineClient();
  console.log(output);
}
