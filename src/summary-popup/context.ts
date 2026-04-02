import { listTmuxPanes, resolveTmuxClientLocation } from "../tmux/index.js";
import { findJumpAnchorByClientTty } from "../tmux/jump-anchor.js";
import type { SummaryPopupContext } from "./model.js";

export async function resolveSummaryPopupContext(
  targetClient?: string,
): Promise<SummaryPopupContext | undefined> {
  if (!targetClient) return undefined;

  const location = await resolveTmuxClientLocation({
    targetClient,
    insideTmux: true,
  });
  if (!location) return undefined;

  const panes = await listTmuxPanes();
  const currentCwd = panes.find(
    (pane) =>
      pane.sessionId === location.sessionId &&
      pane.windowId === location.windowId &&
      pane.paneId === location.paneId,
  )?.cwd;
  const anchor = await findJumpAnchorByClientTty(targetClient);

  if (!currentCwd && !anchor?.originCwd) {
    return undefined;
  }

  return {
    currentCwd,
    originCwd: anchor?.originCwd,
  };
}
