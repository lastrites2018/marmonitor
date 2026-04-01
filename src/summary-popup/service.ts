import { readHealthyCollectorSnapshotForRequest } from "../collector/client.js";
import type { MarmonitorConfig } from "../config/index.js";
import { getAgentsSnapshot } from "../snapshot/service.js";
import type { AgentSession } from "../types.js";

export async function loadSummaryPopupAgents(
  params: {
    config: MarmonitorConfig;
    requestedConfigPath?: string;
    collectorOnly?: boolean;
  },
  deps: {
    readCollectorSnapshot?: typeof readHealthyCollectorSnapshotForRequest;
    getLiveSnapshot?: typeof getAgentsSnapshot;
  } = {},
): Promise<{ agents?: AgentSession[]; source: "collector" | "live" | "unavailable" }> {
  const readCollectorSnapshot =
    deps.readCollectorSnapshot ?? readHealthyCollectorSnapshotForRequest;
  const getLiveSnapshot = deps.getLiveSnapshot ?? getAgentsSnapshot;
  const collectorAgents = await readCollectorSnapshot({
    config: params.config,
    requestedConfigPath: params.requestedConfigPath,
  });
  if (collectorAgents) {
    return { agents: collectorAgents, source: "collector" };
  }

  if (params.collectorOnly) {
    return { agents: undefined, source: "unavailable" };
  }

  const liveAgents = await getLiveSnapshot(params.config, {
    enrichmentMode: "light",
    includeStdoutHeuristic: true,
    useSharedRuntimeSnapshots: true,
  });
  return { agents: liveAgents, source: "live" };
}
