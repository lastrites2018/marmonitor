import { buildStatuslinePathLabels, formatElapsedCompact, shortenPath } from "../output/utils.js";
import type { AgentSession } from "../types.js";
import {
  buildSummaryPopupPage,
  buildSummaryPopupSections,
  buildSummaryPopupSelections,
  summaryPopupTitle,
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

function popupLine(index: number, agent: AgentSession, label: string): string {
  const icon = popupPhaseIcon(agent);
  const elapsed = popupElapsed(agent);
  const iconPrefix = icon ? `${icon} ` : "";
  const headline = `${index}. ${iconPrefix}${popupAgentName(agent.agentName)} ${label}${elapsed ? ` ${elapsed}` : ""}`;
  const detail = `   PID: ${agent.pid}  ${shortenPath(agent.cwd)}`;
  return `${headline}\n${detail}`;
}

function popupEmptyState(target: SummaryPopupTarget): string {
  if (target === "issue") return "Nothing to review right now.";
  return "No matching sessions.";
}

export function renderSummaryPopup(agents: AgentSession[], target: SummaryPopupTarget): string {
  const items = buildSummaryPopupSelections(agents).itemsByTarget[target];
  const title = summaryPopupTitle(target, items.length);
  if (items.length === 0) {
    return `${title}\n\n${popupEmptyState(target)}`;
  }

  if (target !== "issue") {
    const labels = buildStatuslinePathLabels(items, 32);
    return `${title}\n\n${items.map((agent, index) => popupLine(index + 1, agent, labels[index])).join("\n\n")}`;
  }

  const sections = buildSummaryPopupSections(agents, target);
  let currentIndex = 1;
  const renderedSections = sections.map((section) => {
    const labels = buildStatuslinePathLabels(section.items, 32);
    const body = section.items
      .map((agent, index) => popupLine(currentIndex + index, agent, labels[index]))
      .join("\n\n");
    currentIndex += section.items.length;
    return `${section.title}\n\n${body}`;
  });

  return `${title}\n\n${renderedSections.join("\n\n")}`;
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

function formatPageControls(itemCount: number, totalPages: number): string {
  const jumpLabel = itemCount >= 10 ? "1-9, 0=10" : `1-${itemCount}`;
  const pagingLabel = totalPages > 1 ? "  •  n/p page" : "";
  return `${jumpLabel} select  •  Enter open${pagingLabel}  •  q close`;
}

export function renderSummaryPopupPage(
  agents: AgentSession[],
  target: SummaryPopupTarget,
  page: number,
  pageSize = 10,
): string {
  const popupPage = buildSummaryPopupPage(agents, target, page, { pageSize });
  const title = formatPageHeader(popupPage.title, popupPage.page, popupPage.totalPages);
  if (popupPage.totalItems === 0) {
    return `${title}\n\n${popupEmptyState(target)}`;
  }
  const pageWindow = formatPageWindow(
    popupPage.startIndex,
    popupPage.items.length,
    popupPage.totalItems,
  );
  const controls = formatPageControls(popupPage.items.length, popupPage.totalPages);

  if (target !== "issue") {
    const labels = buildStatuslinePathLabels(popupPage.items, 32);
    const body = popupPage.items
      .map((agent, index) => popupLine(index + 1, agent, labels[index]))
      .join("\n\n");
    return `${title}${pageWindow ? `\n${pageWindow}` : ""}\n\n${body}\n\n${controls}`;
  }

  let currentIndex = 1;
  const renderedSections = popupPage.sections.map((section) => {
    const labels = buildStatuslinePathLabels(section.items, 32);
    const heading =
      section.items.length === section.totalCount
        ? section.title
        : `${section.title.replace(/\(\d+\)$/, "").trim()} (${section.items.length}/${section.totalCount})`;
    const body = section.items
      .map((agent, index) => popupLine(currentIndex + index, agent, labels[index]))
      .join("\n\n");
    currentIndex += section.items.length;
    return `${heading}\n\n${body}`;
  });

  return `${title}${pageWindow ? `\n${pageWindow}` : ""}\n\n${renderedSections.join("\n\n")}\n\n${controls}`;
}
