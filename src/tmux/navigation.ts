import type { AgentSession } from "../types.js";
import {
  type TmuxClientLocation,
  type TmuxJumpBackResult,
  type TmuxJumpOptions,
  type TmuxJumpResult,
  type TmuxJumpTarget,
  jumpBackToTmuxAnchor,
  jumpToTmuxPane,
  listTmuxClientIds,
  listTmuxPanes,
  resolveTmuxClientLocation,
  resolveTmuxJumpTarget,
} from "./index.js";
import {
  type TmuxJumpAnchor,
  clearJumpAnchor,
  pruneJumpAnchors,
  readJumpAnchor,
  writeJumpAnchor,
} from "./jump-anchor.js";
import {
  JUMP_BRIEFING_TTL_MS,
  type TmuxJumpBriefing,
  buildJumpBriefingText,
  writeJumpBriefing,
} from "./jump-briefing.js";

interface JumpNavigationDeps {
  jumpToTmuxPane?: typeof jumpToTmuxPane;
  listTmuxClientIds?: typeof listTmuxClientIds;
  listTmuxPanes?: typeof listTmuxPanes;
  pruneJumpAnchors?: typeof pruneJumpAnchors;
  readJumpAnchor?: typeof readJumpAnchor;
  resolveTmuxClientLocation?: typeof resolveTmuxClientLocation;
  resolveTmuxJumpTarget?: typeof resolveTmuxJumpTarget;
  writeJumpBriefing?: typeof writeJumpBriefing;
  writeJumpAnchor?: typeof writeJumpAnchor;
}

async function resolveOriginCwd(
  location: TmuxClientLocation,
  listPanes: typeof listTmuxPanes = listTmuxPanes,
): Promise<string | undefined> {
  const panes = await listPanes();
  return panes.find(
    (pane) =>
      pane.sessionName === location.sessionName &&
      pane.windowIndex === location.windowIndex &&
      pane.paneIndex === location.paneIndex,
  )?.cwd;
}

async function buildJumpAnchor(
  location: TmuxClientLocation,
  target: TmuxJumpTarget,
  deps: JumpNavigationDeps = {},
): Promise<TmuxJumpAnchor> {
  const now = Date.now();
  return {
    clientId: location.clientId,
    clientTty: location.clientTty,
    originSessionId: location.sessionId,
    originWindowId: location.windowId,
    originPaneId: location.paneId,
    originCwd: await resolveOriginCwd(location, deps.listTmuxPanes),
    lastJumpTargetSessionId: target.pane.sessionId,
    lastJumpTargetWindowId: target.pane.windowId,
    lastJumpTargetPaneId: target.pane.paneId,
    recordedAt: now,
    lastJumpedAt: now,
  };
}

function buildJumpBriefing(
  location: TmuxClientLocation,
  agent: Pick<AgentSession, "cwd"> &
    Partial<
      Pick<AgentSession, "agentName" | "phase" | "lastActivityAt" | "lastResponseAt" | "startedAt">
    >,
  reason: "keyboard" | "popup",
): TmuxJumpBriefing {
  const nowMs = Date.now();
  return {
    clientId: location.clientId,
    clientTty: location.clientTty,
    text: buildJumpBriefingText(agent, nowMs / 1000),
    reason,
    createdAt: nowMs,
    expiresAt: nowMs + JUMP_BRIEFING_TTL_MS,
  };
}

function touchJumpAnchor(anchor: TmuxJumpAnchor, target: TmuxJumpTarget): TmuxJumpAnchor {
  const now = Date.now();
  return {
    ...anchor,
    lastJumpTargetSessionId: target.pane.sessionId,
    lastJumpTargetWindowId: target.pane.windowId,
    lastJumpTargetPaneId: target.pane.paneId,
    lastJumpedAt: now,
  };
}

function isSameTmuxPaneTarget(target: TmuxJumpTarget, location: TmuxClientLocation): boolean {
  return (
    target.pane.sessionName === location.sessionName &&
    target.pane.windowIndex === location.windowIndex &&
    target.pane.paneIndex === location.paneIndex
  );
}

function buildJumpResult(
  agent: Pick<AgentSession, "pid" | "cwd">,
  target: TmuxJumpTarget | undefined,
  options: TmuxJumpOptions,
  executed: boolean,
  noop = false,
  message?: string,
): TmuxJumpResult {
  const insideTmux = options.insideTmux ?? Boolean(process.env.TMUX);
  if (!target) {
    return {
      found: false,
      executed: false,
      insideTmux,
      pid: agent.pid,
      cwd: agent.cwd,
      message: message ?? "No tmux pane matched this AI session.",
    };
  }

  return {
    found: true,
    executed,
    noop,
    insideTmux,
    pid: agent.pid,
    match: target.match,
    target: target.pane.target,
    sessionName: target.pane.sessionName,
    cwd: target.pane.cwd,
    message:
      message ??
      (executed
        ? `Switched to ${target.pane.target} via ${target.match}.`
        : `Matched ${target.pane.target} via ${target.match}, but tmux switch failed.`),
  };
}

async function pruneAnchorsBestEffort(deps: JumpNavigationDeps = {}): Promise<void> {
  try {
    const loadClientIds = deps.listTmuxClientIds ?? listTmuxClientIds;
    const prune = deps.pruneJumpAnchors ?? pruneJumpAnchors;
    await prune({
      activeClientIds: await loadClientIds(),
    });
  } catch {
    // anchor cleanup must never block jump commands
  }
}

export async function jumpToAgentWithAnchor(
  agent: Pick<AgentSession, "pid" | "cwd"> &
    Partial<
      Pick<AgentSession, "agentName" | "phase" | "lastActivityAt" | "lastResponseAt" | "startedAt">
    >,
  options: TmuxJumpOptions = {},
  deps: JumpNavigationDeps = {},
): Promise<TmuxJumpResult> {
  const resolveClientLocation = deps.resolveTmuxClientLocation ?? resolveTmuxClientLocation;
  const readAnchor = deps.readJumpAnchor ?? readJumpAnchor;
  const resolveJumpTarget = deps.resolveTmuxJumpTarget ?? resolveTmuxJumpTarget;
  const executeJump = deps.jumpToTmuxPane ?? jumpToTmuxPane;
  const persistBriefing = deps.writeJumpBriefing ?? writeJumpBriefing;
  const persistAnchor = deps.writeJumpAnchor ?? writeJumpAnchor;

  await pruneAnchorsBestEffort(deps);
  const origin = await resolveClientLocation(options);
  const existingAnchor = origin ? await readAnchor(origin.clientId) : undefined;
  const target = await resolveJumpTarget(agent);
  if (!target) {
    return buildJumpResult(agent, undefined, options, false);
  }

  if (origin && isSameTmuxPaneTarget(target, origin)) {
    return buildJumpResult(
      agent,
      target,
      options,
      true,
      true,
      `Already at ${target.pane.target}; jump-back anchor unchanged.`,
    );
  }

  const executed = await executeJump(target, options);
  const result = buildJumpResult(agent, target, options, executed);
  if (!executed || !origin) {
    return result;
  }

  const anchor = existingAnchor
    ? touchJumpAnchor(existingAnchor, target)
    : await buildJumpAnchor(origin, target, deps);
  await persistAnchor(anchor);
  if (options.briefingSource) {
    await persistBriefing(buildJumpBriefing(origin, agent, options.briefingSource));
  }
  return result;
}

export async function jumpBackForClient(
  options: TmuxJumpOptions = {},
): Promise<TmuxJumpBackResult> {
  await pruneAnchorsBestEffort();
  const currentClient = await resolveTmuxClientLocation(options);
  const insideTmux = options.insideTmux ?? Boolean(process.env.TMUX);
  if (!currentClient) {
    return {
      found: false,
      executed: false,
      insideTmux,
      message: "No tmux client context is available for jump-back.",
    };
  }

  const anchor = await readJumpAnchor(currentClient.clientId);
  if (!anchor) {
    return {
      found: false,
      executed: false,
      insideTmux,
      clientId: currentClient.clientId,
      message: "No jump origin is recorded for this tmux client.",
    };
  }

  const result = await jumpBackToTmuxAnchor(anchor, options);
  if (result.executed || result.anchorInvalid) {
    await clearJumpAnchor(currentClient.clientId);
  }
  return result;
}
