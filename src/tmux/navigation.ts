import type { AgentSession } from "../types.js";
import {
  type TmuxClientLocation,
  type TmuxJumpBackResult,
  type TmuxJumpOptions,
  type TmuxJumpResult,
  jumpBackToTmuxAnchor,
  jumpToAgent,
  listTmuxClientIds,
  listTmuxPanes,
  resolveTmuxClientLocation,
} from "./index.js";
import {
  type TmuxJumpAnchor,
  clearJumpAnchor,
  pruneJumpAnchors,
  readJumpAnchor,
  writeJumpAnchor,
} from "./jump-anchor.js";

async function resolveOriginCwd(location: TmuxClientLocation): Promise<string | undefined> {
  const panes = await listTmuxPanes();
  return panes.find(
    (pane) =>
      pane.sessionName === location.sessionName &&
      pane.windowIndex === location.windowIndex &&
      pane.paneIndex === location.paneIndex,
  )?.cwd;
}

async function buildJumpAnchor(location: TmuxClientLocation): Promise<TmuxJumpAnchor> {
  const now = Date.now();
  return {
    clientId: location.clientId,
    clientTty: location.clientTty,
    originSessionId: location.sessionId,
    originWindowId: location.windowId,
    originPaneId: location.paneId,
    originCwd: await resolveOriginCwd(location),
    recordedAt: now,
    lastJumpedAt: now,
  };
}

function touchJumpAnchor(anchor: TmuxJumpAnchor): TmuxJumpAnchor {
  const now = Date.now();
  return {
    ...anchor,
    lastJumpedAt: now,
  };
}

async function pruneAnchorsBestEffort(): Promise<void> {
  try {
    await pruneJumpAnchors({
      activeClientIds: await listTmuxClientIds(),
    });
  } catch {
    // anchor cleanup must never block jump commands
  }
}

export async function jumpToAgentWithAnchor(
  agent: Pick<AgentSession, "pid" | "cwd">,
  options: TmuxJumpOptions = {},
): Promise<TmuxJumpResult> {
  await pruneAnchorsBestEffort();
  const origin = await resolveTmuxClientLocation(options);
  const existingAnchor = origin ? await readJumpAnchor(origin.clientId) : undefined;

  const result = await jumpToAgent(agent, options);
  if (!result.executed || !origin) {
    return result;
  }

  const anchor = existingAnchor ? touchJumpAnchor(existingAnchor) : await buildJumpAnchor(origin);
  await writeJumpAnchor(anchor);
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
