import { tmpdir } from "node:os";
import type { MarmonitorConfig } from "../config/index.js";
import type { AgentSession } from "../types.js";
import {
  type TmuxClientLocation,
  type TmuxRuntimeSnapshot,
  jumpBackToTmuxAnchor,
  listTmuxClientLocations,
  selectTmuxPaneForAgent,
} from "./index.js";
import {
  type TmuxJumpAnchor,
  clearJumpAnchor,
  listJumpAnchorClientIds,
  readJumpAnchor,
} from "./jump-anchor.js";

export const AUTO_RETURN_ACTIVE_CLIENT_GRACE_MS = 30_000;

export interface StaleJumpAutoReturnResult {
  checked: number;
  executed: number;
  cleared: number;
}

interface StaleJumpAutoReturnDeps {
  listJumpAnchorClientIds?: typeof listJumpAnchorClientIds;
  readJumpAnchor?: typeof readJumpAnchor;
  clearJumpAnchor?: typeof clearJumpAnchor;
  listTmuxClientLocations?: typeof listTmuxClientLocations;
  jumpBackToTmuxAnchor?: typeof jumpBackToTmuxAnchor;
  nowMs?: number;
  root?: string;
}

function tmuxTimeToMs(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return value > 10_000_000_000 ? value : value * 1000;
}

function isCurrentLocationStillOnTarget(
  anchor: TmuxJumpAnchor,
  location: TmuxClientLocation,
): boolean {
  return Boolean(
    anchor.lastJumpTargetSessionId &&
      anchor.lastJumpTargetWindowId &&
      anchor.lastJumpTargetPaneId &&
      anchor.lastJumpTargetSessionId === location.sessionId &&
      anchor.lastJumpTargetWindowId === location.windowId &&
      anchor.lastJumpTargetPaneId === location.paneId,
  );
}

function hasRecentClientActivity(
  location: TmuxClientLocation,
  nowMs: number,
  activeGraceMs: number,
): boolean | undefined {
  const activityMs = tmuxTimeToMs(location.clientActivityAt);
  if (activityMs === undefined) return undefined;
  return nowMs - activityMs <= activeGraceMs;
}

function selectIdleTargetRepresentative(
  anchor: TmuxJumpAnchor,
  agents: AgentSession[],
  tmuxSnapshot: TmuxRuntimeSnapshot,
): AgentSession | undefined {
  const paneId = anchor.lastJumpTargetPaneId;
  if (!paneId) return undefined;

  const matchedAgents = agents.filter((agent) => {
    if (!agent.sessionMatched) return false;
    const target = selectTmuxPaneForAgent(agent, tmuxSnapshot.panes, tmuxSnapshot.childMap);
    return target?.match === "pid-tree" && target.pane.paneId === paneId;
  });
  if (matchedAgents.length === 0) return undefined;

  matchedAgents.sort((a, b) => {
    const aTime = a.lastActivityAt ?? a.lastResponseAt ?? a.startedAt ?? 0;
    const bTime = b.lastActivityAt ?? b.lastResponseAt ?? b.startedAt ?? 0;
    return bTime - aTime;
  });
  return matchedAgents[0];
}

export async function runStaleJumpAutoReturnMaintenance(
  agents: AgentSession[],
  config: MarmonitorConfig["integration"]["tmux"]["jumpBack"]["autoReturn"],
  tmuxSnapshot: TmuxRuntimeSnapshot | undefined,
  deps: StaleJumpAutoReturnDeps = {},
): Promise<StaleJumpAutoReturnResult> {
  if (!config.enabled || !tmuxSnapshot || agents.length === 0) {
    return { checked: 0, executed: 0, cleared: 0 };
  }

  const loadClientIds = deps.listJumpAnchorClientIds ?? listJumpAnchorClientIds;
  const loadAnchor = deps.readJumpAnchor ?? readJumpAnchor;
  const removeAnchor = deps.clearJumpAnchor ?? clearJumpAnchor;
  const loadClients = deps.listTmuxClientLocations ?? listTmuxClientLocations;
  const jumpBack = deps.jumpBackToTmuxAnchor ?? jumpBackToTmuxAnchor;
  const nowMs = deps.nowMs ?? Date.now();
  const root = deps.root ?? tmpdir();
  const idleThresholdMs = config.afterIdleMin * 60 * 1000;

  const [clientIds, clients] = await Promise.all([loadClientIds(root), loadClients()]);
  if (clientIds.length === 0 || clients.length === 0) {
    return { checked: 0, executed: 0, cleared: 0 };
  }

  const clientsById = new Map(clients.map((client) => [client.clientId, client]));
  let checked = 0;
  let executed = 0;
  let cleared = 0;

  for (const clientId of clientIds) {
    const anchor = await loadAnchor(clientId, root);
    const location = anchor ? clientsById.get(anchor.clientId) : undefined;
    if (!anchor || !location) {
      continue;
    }

    checked += 1;

    if (!isCurrentLocationStillOnTarget(anchor, location)) {
      continue;
    }

    const recentClientActivity = hasRecentClientActivity(
      location,
      nowMs,
      AUTO_RETURN_ACTIVE_CLIENT_GRACE_MS,
    );
    if (recentClientActivity !== false) {
      continue;
    }

    const targetAgent = selectIdleTargetRepresentative(anchor, agents, tmuxSnapshot);
    if (!targetAgent || targetAgent.status !== "Idle" || !targetAgent.idleSince) {
      continue;
    }
    if (nowMs - targetAgent.idleSince * 1000 < idleThresholdMs) {
      continue;
    }

    const result = await jumpBack(anchor, {
      targetClient: location.clientTty,
      insideTmux: false,
    });
    if (result.executed) {
      executed += 1;
      cleared += 1;
      await removeAnchor(anchor.clientId, root);
      continue;
    }
    if (result.anchorInvalid) {
      cleared += 1;
      await removeAnchor(anchor.clientId, root);
    }
  }

  return { checked, executed, cleared };
}
