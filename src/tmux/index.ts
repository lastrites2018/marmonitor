import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { profileAsync } from "../perf.js";
import type { AgentSession } from "../types.js";
import type { TmuxJumpAnchor } from "./jump-anchor.js";

const execFileAsync = promisify(execFile);

export interface TmuxPane {
  target: string;
  sessionName: string;
  sessionId?: string;
  windowId?: string;
  windowIndex: number;
  paneId?: string;
  paneIndex: number;
  panePid: number;
  cwd: string;
}

export interface TmuxJumpTarget {
  pane: TmuxPane;
  match: "pid-tree" | "cwd";
}

export interface TmuxRuntimeSnapshot {
  panes: TmuxPane[];
  childMap: Map<number, number[]>;
}

export function buildTmuxPidTreeMatchSet(
  agents: Array<Pick<AgentSession, "pid" | "cwd">>,
  snapshot: TmuxRuntimeSnapshot,
): Set<number> {
  const matched = new Set<number>();
  for (const agent of agents) {
    const target = selectTmuxPaneForAgent(agent, snapshot.panes, snapshot.childMap);
    if (target?.match === "pid-tree") {
      matched.add(agent.pid);
    }
  }
  return matched;
}

export interface TmuxClientLocation {
  clientId: string;
  clientTty: string;
  sessionId: string;
  sessionName: string;
  windowId: string;
  windowIndex: number;
  paneId: string;
  paneIndex: number;
  clientActivityAt?: number;
}

interface TmuxRuntimeSnapshotLoaders {
  listPanes?: () => Promise<TmuxPane[]>;
  getProcessTree?: () => Promise<Map<number, number[]>>;
}

export interface TmuxJumpResult {
  found: boolean;
  executed: boolean;
  noop?: boolean;
  insideTmux: boolean;
  pid: number;
  match?: "pid-tree" | "cwd";
  target?: string;
  sessionName?: string;
  cwd?: string;
  message?: string;
}

export interface TmuxJumpOptions {
  targetClient?: string;
  insideTmux?: boolean;
  briefingSource?: "keyboard" | "popup";
}

export interface TmuxJumpBackResult {
  found: boolean;
  executed: boolean;
  insideTmux: boolean;
  clientId?: string;
  level?: "pane" | "window" | "session";
  target?: string;
  anchorInvalid?: boolean;
  message?: string;
}

export function parseTmuxPanes(raw: string): TmuxPane[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [target, panePidRaw, cwd, sessionId, windowId, paneId] = line.split("\t");
      if (!target || !panePidRaw || !cwd) return [];
      const [sessionName, coords] = target.split(":");
      if (!sessionName || !coords) return [];
      const [windowIndexRaw, paneIndexRaw] = coords.split(".");
      if (!windowIndexRaw || !paneIndexRaw) return [];
      const pane = {
        target,
        sessionName,
        sessionId,
        windowId,
        windowIndex: Number.parseInt(windowIndexRaw, 10),
        paneId,
        paneIndex: Number.parseInt(paneIndexRaw, 10),
        panePid: Number.parseInt(panePidRaw, 10),
        cwd,
      } satisfies TmuxPane;
      return Number.isFinite(pane.panePid) ? [pane] : [];
    })
    .filter((pane) => Number.isFinite(pane.panePid));
}

export function parseTmuxClientLocation(raw: string): TmuxClientLocation | undefined {
  const [
    clientIdRaw,
    clientTty,
    sessionId,
    sessionName,
    windowId,
    windowIndexRaw,
    paneId,
    paneIndexRaw,
    clientActivityRaw,
  ] = raw.replace(/\r?\n$/, "").split("\t");
  const clientId = clientIdRaw || clientTty;
  const windowIndex = Number.parseInt(windowIndexRaw ?? "", 10);
  const paneIndex = Number.parseInt(paneIndexRaw ?? "", 10);
  if (
    !clientId ||
    !clientTty ||
    !sessionId ||
    !sessionName ||
    !windowId ||
    !paneId ||
    !Number.isFinite(windowIndex) ||
    !Number.isFinite(paneIndex)
  ) {
    return undefined;
  }
  return {
    clientId,
    clientTty,
    sessionId,
    sessionName,
    windowId,
    windowIndex,
    paneId,
    paneIndex,
    clientActivityAt: Number.isFinite(Number.parseInt(clientActivityRaw ?? "", 10))
      ? Number.parseInt(clientActivityRaw ?? "", 10)
      : undefined,
  };
}

export function parseProcessTree(raw: string): Map<number, number[]> {
  const childMap = new Map<number, number[]>();

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [pidRaw, ppidRaw] = trimmed.split(/\s+/);
    const pid = Number.parseInt(pidRaw, 10);
    const ppid = Number.parseInt(ppidRaw, 10);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    const children = childMap.get(ppid) ?? [];
    children.push(pid);
    childMap.set(ppid, children);
  }

  return childMap;
}

export function isPidInTree(
  rootPid: number,
  targetPid: number,
  childMap: Map<number, number[]>,
): boolean {
  if (rootPid === targetPid) return true;
  const queue = [...(childMap.get(rootPid) ?? [])];
  const seen = new Set<number>();

  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined || seen.has(pid)) continue;
    if (pid === targetPid) return true;
    seen.add(pid);
    queue.push(...(childMap.get(pid) ?? []));
  }

  return false;
}

export function selectTmuxPaneForAgent(
  agent: Pick<AgentSession, "pid" | "cwd">,
  panes: TmuxPane[],
  childMap: Map<number, number[]>,
): TmuxJumpTarget | undefined {
  const treeMatch = panes.find((pane) => isPidInTree(pane.panePid, agent.pid, childMap));
  if (treeMatch) {
    return { pane: treeMatch, match: "pid-tree" };
  }

  const cwdMatch = panes.find((pane) => pane.cwd === agent.cwd);
  if (cwdMatch) {
    return { pane: cwdMatch, match: "cwd" };
  }

  return undefined;
}

let tmuxRuntimeSnapshotPromise: Promise<TmuxRuntimeSnapshot> | undefined;

export async function listTmuxPanes(): Promise<TmuxPane[]> {
  try {
    const { stdout } = await profileAsync("tmux", "list_panes", () =>
      execFileAsync("tmux", [
        "list-panes",
        "-a",
        "-F",
        "#{session_name}:#{window_index}.#{pane_index}\t#{pane_pid}\t#{pane_current_path}\t#{session_id}\t#{window_id}\t#{pane_id}",
      ]),
    );
    return parseTmuxPanes(stdout);
  } catch {
    return [];
  }
}

export async function getProcessTree(): Promise<Map<number, number[]>> {
  try {
    const { stdout } = await profileAsync("tmux", "process_tree", () =>
      execFileAsync("ps", ["-eo", "pid=,ppid="]),
    );
    return parseProcessTree(stdout);
  } catch {
    return new Map();
  }
}

export async function listTmuxClientIds(): Promise<string[]> {
  const locations = await listTmuxClientLocations();
  return locations.map((location) => location.clientId);
}

export async function listTmuxClientLocations(): Promise<TmuxClientLocation[]> {
  try {
    const { stdout } = await profileAsync("tmux", "list_clients", () =>
      execFileAsync("tmux", [
        "list-clients",
        "-F",
        "#{client_id}\t#{client_tty}\t#{session_id}\t#{session_name}\t#{window_id}\t#{window_index}\t#{pane_id}\t#{pane_index}\t#{client_activity}",
      ]),
    );
    return stdout
      .split("\n")
      .map((line) => parseTmuxClientLocation(line))
      .flatMap((location) => (location ? [location] : []));
  } catch {
    return [];
  }
}

export async function resolveTmuxClientLocation(
  options: TmuxJumpOptions = {},
): Promise<TmuxClientLocation | undefined> {
  const insideTmux = options.insideTmux ?? Boolean(process.env.TMUX);
  if (!options.targetClient && !insideTmux) {
    return undefined;
  }

  if (options.targetClient) {
    try {
      const { stdout } = await profileAsync("tmux", "list_clients", () =>
        execFileAsync("tmux", [
          "list-clients",
          "-F",
          "#{client_id}\t#{client_tty}\t#{session_id}\t#{session_name}\t#{window_id}\t#{window_index}\t#{pane_id}\t#{pane_index}\t#{client_activity}",
        ]),
      );
      const location = stdout
        .split("\n")
        .map((line) => parseTmuxClientLocation(line))
        .find((candidate) => candidate?.clientTty === options.targetClient);
      if (location) {
        return location;
      }
    } catch {
      // fall through to direct display-message resolution
    }
  }

  const args = ["display-message", "-p"];
  if (options.targetClient) {
    args.push("-t", options.targetClient);
  }
  args.push(
    "#{client_id}\t#{client_tty}\t#{session_id}\t#{session_name}\t#{window_id}\t#{window_index}\t#{pane_id}\t#{pane_index}",
  );

  try {
    const { stdout } = await profileAsync("tmux", "resolve_client_location", () =>
      execFileAsync("tmux", args),
    );
    return parseTmuxClientLocation(stdout);
  } catch {
    return undefined;
  }
}

export async function getTmuxRuntimeSnapshot(
  loaders: TmuxRuntimeSnapshotLoaders = {},
): Promise<TmuxRuntimeSnapshot> {
  if (tmuxRuntimeSnapshotPromise) {
    return await tmuxRuntimeSnapshotPromise;
  }

  const loadPanes = loaders.listPanes ?? listTmuxPanes;
  const loadProcessTree = loaders.getProcessTree ?? getProcessTree;
  const snapshotPromise = profileAsync("tmux", "resolve_snapshot", async () => {
    const [panes, childMap] = await Promise.all([loadPanes(), loadProcessTree()]);
    return { panes, childMap };
  });
  tmuxRuntimeSnapshotPromise = snapshotPromise;

  try {
    return await snapshotPromise;
  } finally {
    if (tmuxRuntimeSnapshotPromise === snapshotPromise) {
      tmuxRuntimeSnapshotPromise = undefined;
    }
  }
}

export function resetTmuxRuntimeSnapshotForTests(): void {
  tmuxRuntimeSnapshotPromise = undefined;
}

export async function resolveTmuxJumpTarget(
  agent: Pick<AgentSession, "pid" | "cwd">,
  loaders: TmuxRuntimeSnapshotLoaders = {},
): Promise<TmuxJumpTarget | undefined> {
  try {
    const { panes, childMap } = await profileAsync("tmux", "resolve_jump_target", () =>
      getTmuxRuntimeSnapshot(loaders),
    );
    return selectTmuxPaneForAgent(agent, panes, childMap);
  } catch {
    return undefined;
  }
}

export async function captureTmuxPaneOutput(
  target: TmuxJumpTarget,
  lines = 30,
): Promise<string | undefined> {
  try {
    const { stdout } = await profileAsync("tmux", "capture_pane", () =>
      execFileAsync("tmux", ["capture-pane", "-p", "-t", target.pane.target, "-S", `-${lines}`]),
    );
    return stdout;
  } catch {
    return undefined;
  }
}

export function buildTmuxPaneJumpCommands(
  target: TmuxJumpTarget,
  options: TmuxJumpOptions = {},
): string[][] {
  const windowTarget = `${target.pane.sessionName}:${target.pane.windowIndex}`;
  const insideTmux = options.insideTmux ?? Boolean(process.env.TMUX);

  if (options.targetClient) {
    return [["switch-client", "-c", options.targetClient, "-t", target.pane.target]];
  }

  if (insideTmux) {
    return [
      ["switch-client", "-t", windowTarget],
      ["select-window", "-t", windowTarget],
      ["select-pane", "-t", target.pane.target],
    ];
  }

  return [
    ["select-window", "-t", windowTarget],
    ["select-pane", "-t", target.pane.target],
  ];
}

function executeTmuxCommands(commands: string[][]): Promise<boolean> {
  return (async () => {
    try {
      for (const argv of commands) {
        const label = argv[0].replace(/-/g, "_");
        await profileAsync("tmux", label, () => execFileAsync("tmux", argv));
      }
      return true;
    } catch {
      return false;
    }
  })();
}

export async function jumpToTmuxPane(
  target: TmuxJumpTarget,
  options: TmuxJumpOptions = {},
): Promise<boolean> {
  const commands = buildTmuxPaneJumpCommands(target, options);
  return await executeTmuxCommands(commands);
}

export async function jumpToAgent(
  agent: Pick<AgentSession, "pid" | "cwd">,
  options: TmuxJumpOptions = {},
): Promise<TmuxJumpResult> {
  const target = await resolveTmuxJumpTarget(agent);
  const insideTmux = options.insideTmux ?? Boolean(process.env.TMUX);
  if (!target) {
    return {
      found: false,
      executed: false,
      insideTmux,
      pid: agent.pid,
      cwd: agent.cwd,
      message: "No tmux pane matched this AI session.",
    };
  }

  const executed = await jumpToTmuxPane(target, options);
  return {
    found: true,
    executed,
    insideTmux,
    pid: agent.pid,
    match: target.match,
    target: target.pane.target,
    sessionName: target.pane.sessionName,
    cwd: target.pane.cwd,
    message: executed
      ? `Switched to ${target.pane.target} via ${target.match}.`
      : `Matched ${target.pane.target} via ${target.match}, but tmux switch failed.`,
  };
}

export function buildTmuxAnchorReturnCommands(
  anchor: TmuxJumpAnchor,
  level: "pane" | "window" | "session",
  options: TmuxJumpOptions = {},
): string[][] {
  const insideTmux = options.insideTmux ?? Boolean(process.env.TMUX);
  const target =
    level === "pane"
      ? anchor.originPaneId
      : level === "window"
        ? anchor.originWindowId
        : anchor.originSessionId;

  if (options.targetClient) {
    return [["switch-client", "-c", options.targetClient, "-t", target]];
  }

  if (level === "session") {
    return [["switch-client", "-t", target]];
  }

  if (insideTmux) {
    const commands = [["switch-client", "-t", anchor.originWindowId]];
    if (level === "window") {
      commands.push(["select-window", "-t", anchor.originWindowId]);
      return commands;
    }
    commands.push(["select-window", "-t", anchor.originWindowId]);
    commands.push(["select-pane", "-t", anchor.originPaneId]);
    return commands;
  }

  if (level === "window") {
    return [["select-window", "-t", anchor.originWindowId]];
  }

  return [
    ["select-window", "-t", anchor.originWindowId],
    ["select-pane", "-t", anchor.originPaneId],
  ];
}

export async function jumpBackToTmuxAnchor(
  anchor: TmuxJumpAnchor,
  options: TmuxJumpOptions = {},
): Promise<TmuxJumpBackResult> {
  const insideTmux = options.insideTmux ?? Boolean(process.env.TMUX);

  for (const level of ["pane", "window", "session"] as const) {
    const commands = buildTmuxAnchorReturnCommands(anchor, level, options);
    if (commands.length === 0) continue;
    const executed = await executeTmuxCommands(commands);
    if (executed) {
      const target =
        level === "pane"
          ? anchor.originPaneId
          : level === "window"
            ? anchor.originWindowId
            : anchor.originSessionId;
      return {
        found: true,
        executed: true,
        insideTmux,
        clientId: anchor.clientId,
        level,
        target,
        message: `Returned to ${target} via ${level}.`,
      };
    }
  }

  return {
    found: true,
    executed: false,
    insideTmux,
    clientId: anchor.clientId,
    anchorInvalid: true,
    message: "Recorded jump origin is no longer available.",
  };
}
