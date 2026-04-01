import { buildStatuslinePathLabels, formatElapsedCompact, shortenPath } from "../output/utils.js";
import type { AgentSession } from "../types.js";
import { buildSummaryPopupSelections, summaryPopupTitle } from "./model.js";
import type { SummaryPopupTarget } from "./shared.js";

function popupPhaseIcon(agent: AgentSession): string {
  if (agent.phase === "permission") return "⏳";
  if (agent.phase === "thinking") return "🤔";
  if (agent.phase === "tool") return "🔧";
  if (agent.status === "Stalled" || agent.status === "Unmatched") return "⚠";
  return "•";
}

function popupAgentName(agentName: string): string {
  if (agentName === "Claude Code") return "Claude";
  return agentName;
}

function popupElapsed(
  agent: Pick<AgentSession, "lastActivityAt" | "lastResponseAt" | "startedAt">,
): string | undefined {
  return formatElapsedCompact(agent.lastActivityAt ?? agent.lastResponseAt ?? agent.startedAt);
}

function popupLine(index: number, agent: AgentSession, label: string): string {
  const icon = popupPhaseIcon(agent);
  const elapsed = popupElapsed(agent);
  const headline = `${index}. ${icon} ${popupAgentName(agent.agentName)} ${label}${elapsed ? ` ${elapsed}` : ""}`;
  const detail = `   PID: ${agent.pid}  ${shortenPath(agent.cwd)}`;
  return `${headline}\n${detail}`;
}

export function renderSummaryPopup(agents: AgentSession[], target: SummaryPopupTarget): string {
  const items = buildSummaryPopupSelections(agents).itemsByTarget[target];
  const title = summaryPopupTitle(target, items.length);
  if (items.length === 0) {
    return `${title}\n\nNo matching sessions.`;
  }

  const labels = buildStatuslinePathLabels(items, 32);
  return `${title}\n\n${items.map((agent, index) => popupLine(index + 1, agent, labels[index])).join("\n\n")}`;
}
