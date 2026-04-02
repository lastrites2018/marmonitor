import { buildStatuslinePathLabels, formatElapsedCompact, shortenPath } from "../output/utils.js";
import type { AgentSession } from "../types.js";
import type { SummaryPopupControlsMode } from "./layout.js";
import {
  type SummaryPopupContext,
  type SummaryPopupItemMarkers,
  buildSummaryPopupPage,
  buildSummaryPopupView,
} from "./model.js";
import type { SummaryPopupTarget } from "./shared.js";

function popupPhaseIcon(agent: AgentSession): string | undefined {
  if (agent.phase === "permission") return "⏳";
  if (agent.phase === "thinking") return "🤔";
  if (agent.phase === "tool") return "🔧";
  if (agent.status === "Stalled" || agent.status === "Unmatched") return "⚠";
  return undefined;
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

function popupMarkerPrefix(markers: SummaryPopupItemMarkers | undefined): string {
  const parts = [];
  if (markers?.current) parts.push("•");
  if (markers?.origin) parts.push("↩");
  return parts.length > 0 ? `${parts.join("")} ` : "";
}

function popupLine(
  index: number,
  agent: AgentSession,
  label: string,
  markers?: SummaryPopupItemMarkers,
): string {
  const icon = popupPhaseIcon(agent);
  const elapsed = popupElapsed(agent);
  const markerPrefix = popupMarkerPrefix(markers);
  const iconPrefix = icon ? `${icon} ` : "";
  const headline = `${index}. ${markerPrefix}${iconPrefix}${popupAgentName(agent.agentName)} ${label}${elapsed ? ` ${elapsed}` : ""}`;
  const detail = `   PID: ${agent.pid}  ${shortenPath(agent.cwd)}`;
  return `${headline}\n${detail}`;
}

function popupEmptyState(target: SummaryPopupTarget): string {
  if (target === "issue") return "Nothing to review right now.";
  return "No matching sessions.";
}

export function renderSummaryPopup(
  agents: AgentSession[],
  target: SummaryPopupTarget,
  context?: SummaryPopupContext,
): string {
  const view = buildSummaryPopupView(agents, target, {}, context);
  if (view.totalItems === 0) {
    return `${view.title}\n\n${popupEmptyState(target)}`;
  }

  let currentIndex = 1;
  const renderedSections = view.sections.map((section) => {
    const labels = buildStatuslinePathLabels(section.items, 32);
    const body = section.items
      .map((agent, index) =>
        popupLine(currentIndex + index, agent, labels[index], view.markerByPid.get(agent.pid)),
      )
      .join("\n\n");
    currentIndex += section.items.length;
    return `${section.title}\n\n${body}`;
  });

  return `${view.title}\n\n${renderedSections.join("\n\n")}`;
}

function formatSectionHeading(title: string, itemCount: number, totalCount: number): string {
  if (itemCount === totalCount) return title;
  const baseTitle = title.replace(/\(\d+\)$/, "").trim();
  if (!baseTitle) return title;
  return `${baseTitle} (${itemCount}/${totalCount})`;
}

export function renderSummaryPopupPage(
  agents: AgentSession[],
  target: SummaryPopupTarget,
  page: number,
  pageSize = 10,
  options: { controlsMode?: SummaryPopupControlsMode; context?: SummaryPopupContext } = {},
): string {
  const popupPage = buildSummaryPopupPage(agents, target, page, {
    pageSize,
    context: options.context,
  });
  const title = formatPageHeader(popupPage.title, popupPage.page, popupPage.totalPages);
  if (popupPage.totalItems === 0) {
    return `${title}\n\n${popupEmptyState(target)}`;
  }

  const pageWindow = formatPageWindow(
    popupPage.startIndex,
    popupPage.items.length,
    popupPage.totalItems,
  );
  const controls = formatPageControls(
    popupPage.items.length,
    popupPage.totalPages,
    options.controlsMode ?? "full",
  );

  let currentIndex = 1;
  const renderedSections = popupPage.sections.map((section) => {
    const labels = buildStatuslinePathLabels(section.items, 32);
    const heading = formatSectionHeading(section.title, section.items.length, section.totalCount);
    const body = section.items
      .map((agent, index) =>
        popupLine(currentIndex + index, agent, labels[index], popupPage.markerByPid.get(agent.pid)),
      )
      .join("\n\n");
    currentIndex += section.items.length;
    return `${heading}\n\n${body}`;
  });

  return `${title}${pageWindow ? `\n${pageWindow}` : ""}\n\n${renderedSections.join("\n\n")}\n\n${controls}`;
}

function formatPageHeader(title: string, page: number, totalPages: number): string {
  if (totalPages <= 1) return title;
  return `${title}  [Page ${page}/${totalPages}]`;
}

function formatPageWindow(
  startIndex: number,
  itemCount: number,
  totalItems: number,
): string | undefined {
  if (totalItems === 0 || itemCount === 0) return undefined;
  const start = startIndex + 1;
  const end = startIndex + itemCount;
  return `Showing ${start}-${end} of ${totalItems}`;
}

function formatPageControls(
  itemCount: number,
  totalPages: number,
  mode: SummaryPopupControlsMode,
): string {
  const jumpLabel = itemCount >= 10 ? "1-9, 0=10" : `1-${itemCount}`;
  const pagingLabel = totalPages > 1 ? "  •  n/p page" : "";
  if (mode === "minimal") {
    return totalPages > 1 ? `${jumpLabel}  •  n/p  •  q` : `${jumpLabel}  •  q`;
  }
  if (mode === "compact") {
    return `${jumpLabel} select${pagingLabel}  •  q close`;
  }
  return `${jumpLabel} select  •  Enter open${pagingLabel}  •  q close`;
}
