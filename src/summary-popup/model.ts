import {
  type AttentionBuildOptions,
  type AttentionItem,
  buildAttentionItems,
  classifyIdleReuseBucket,
  isPersistentUnmatched,
} from "../output/utils.js";
import type { AgentSession } from "../types.js";
import type { SummaryPopupTarget } from "./shared.js";

export interface SummaryPopupContext {
  currentCwd?: string;
  originCwd?: string;
}

export interface SummaryPopupItemMarkers {
  current?: boolean;
  origin?: boolean;
}

export interface SummaryPopupSelections {
  attentionKinds: Map<number, AttentionItem["kind"]>;
  itemsByTarget: Record<SummaryPopupTarget, AgentSession[]>;
}

export interface SummaryPopupDerivation extends SummaryPopupSelections {
  issueSections: SummaryPopupSection[];
}

export interface SummaryPopupSection {
  key: "context" | "all" | "stalled" | "unmatched";
  title: string;
  items: AgentSession[];
}

export interface SummaryPopupPageSection {
  key: SummaryPopupSection["key"];
  title: string;
  totalCount: number;
  items: AgentSession[];
}

export interface SummaryPopupPage {
  target: SummaryPopupTarget;
  title: string;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  startIndex: number;
  items: AgentSession[];
  sections: SummaryPopupPageSection[];
  markerByPid: Map<number, SummaryPopupItemMarkers>;
}

export interface SummaryPopupView {
  title: string;
  totalItems: number;
  sections: SummaryPopupSection[];
  markerByPid: Map<number, SummaryPopupItemMarkers>;
}

function isAlive(agent: AgentSession): boolean {
  return agent.status !== "Dead" && agent.status !== "Unmatched";
}

function activityTime(
  agent: Pick<AgentSession, "lastActivityAt" | "lastResponseAt" | "startedAt">,
): number {
  return agent.lastActivityAt ?? agent.lastResponseAt ?? agent.startedAt ?? 0;
}

function summarySortPriority(
  agent: AgentSession,
  attentionKinds: Map<number, AttentionItem["kind"]>,
): number {
  const kind = attentionKinds.get(agent.pid);
  if (kind === "permission") return 0;
  if (kind === "thinking") return 1;
  if (kind === "tool") return 2;
  if (agent.status === "Stalled") return 4;
  if (agent.status === "Unmatched") return 5;
  return 3;
}

function orderedSummaryItems(
  agents: AgentSession[],
  attentionKinds: Map<number, AttentionItem["kind"]>,
): AgentSession[] {
  return [...agents].sort((a, b) => {
    const priorityDiff =
      summarySortPriority(a, attentionKinds) - summarySortPriority(b, attentionKinds);
    if (priorityDiff !== 0) return priorityDiff;
    return activityTime(b) - activityTime(a);
  });
}

function idlePopupSortTime(
  agent: Pick<AgentSession, "idleSince" | "lastActivityAt" | "lastResponseAt" | "startedAt">,
): number {
  return agent.idleSince ?? agent.lastActivityAt ?? agent.lastResponseAt ?? agent.startedAt ?? 0;
}

function orderedIdlePopupItems(agents: AgentSession[]): AgentSession[] {
  return [...agents].sort((a, b) => {
    const idleDiff = idlePopupSortTime(b) - idlePopupSortTime(a);
    if (idleDiff !== 0) return idleDiff;
    const agentDiff = a.agentName.localeCompare(b.agentName);
    if (agentDiff !== 0) return agentDiff;
    return a.pid - b.pid;
  });
}

function buildIssueSections(
  agents: AgentSession[],
  attentionKinds: Map<number, AttentionItem["kind"]>,
  options: AttentionBuildOptions = {},
): SummaryPopupSection[] {
  const stalled = orderedSummaryItems(
    agents.filter((agent) => agent.status === "Stalled"),
    attentionKinds,
  );
  const unmatched = orderedSummaryItems(
    agents.filter((agent) => isPersistentUnmatched(agent, { nowSec: options.nowSec })),
    attentionKinds,
  );

  return [
    {
      key: "stalled" as const,
      title: `⚠ Stalled (${stalled.length})`,
      items: stalled,
    },
    {
      key: "unmatched" as const,
      title: `⚠ Persistent Unmatched (${unmatched.length})`,
      items: unmatched,
    },
  ].filter((section) => section.items.length > 0);
}

function findUniqueContextMatch(
  items: AgentSession[],
  cwd: string | undefined,
): AgentSession | undefined {
  if (!cwd) return undefined;
  const matches = items.filter((agent) => agent.cwd === cwd);
  return matches.length === 1 ? matches[0] : undefined;
}

function applySummaryPopupContext(
  sections: SummaryPopupSection[],
  context?: SummaryPopupContext,
): Pick<SummaryPopupView, "sections" | "markerByPid"> {
  const allItems = sections.flatMap((section) => section.items);
  const current = findUniqueContextMatch(allItems, context?.currentCwd);
  const origin = findUniqueContextMatch(allItems, context?.originCwd);
  const markerByPid = new Map<number, SummaryPopupItemMarkers>();
  const contextItems: AgentSession[] = [];

  if (current) {
    markerByPid.set(current.pid, { ...(markerByPid.get(current.pid) ?? {}), current: true });
    contextItems.push(current);
  }
  if (origin) {
    markerByPid.set(origin.pid, { ...(markerByPid.get(origin.pid) ?? {}), origin: true });
    if (!contextItems.some((agent) => agent.pid === origin.pid)) {
      contextItems.push(origin);
    }
  }

  if (contextItems.length === 0) {
    return { sections, markerByPid };
  }

  const contextPidSet = new Set(contextItems.map((agent) => agent.pid));
  const remainingSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((agent) => !contextPidSet.has(agent.pid)),
    }))
    .map((section) =>
      section.key === "all"
        ? {
            ...section,
            title: `Primary Matches (${section.items.length})`,
          }
        : section,
    )
    .filter((section) => section.items.length > 0);

  return {
    sections: [
      { key: "context", title: "Current / Return", items: contextItems },
      ...remainingSections,
    ],
    markerByPid,
  };
}

export function buildSummaryPopupDerivation(
  agents: AgentSession[],
  options: AttentionBuildOptions = {},
): SummaryPopupDerivation {
  const attentionKinds = new Map(
    buildAttentionItems(agents, options).map((item) => [item.pid, item.kind] as const),
  );
  const itemsByTarget = {
    "agent:claude": orderedSummaryItems(
      agents.filter((agent) => isAlive(agent) && agent.agentName === "Claude Code"),
      attentionKinds,
    ),
    "agent:codex": orderedSummaryItems(
      agents.filter((agent) => isAlive(agent) && agent.agentName === "Codex"),
      attentionKinds,
    ),
    "agent:gemini": orderedSummaryItems(
      agents.filter((agent) => isAlive(agent) && agent.agentName === "Gemini"),
      attentionKinds,
    ),
    idle: orderedIdlePopupItems(
      agents.filter((agent) => classifyIdleReuseBucket(agent, { nowSec: options.nowSec })),
    ),
    "phase:permission": orderedSummaryItems(
      agents.filter((agent) => isAlive(agent) && agent.phase === "permission"),
      attentionKinds,
    ),
    "phase:thinking": orderedSummaryItems(
      agents.filter((agent) => isAlive(agent) && attentionKinds.get(agent.pid) === "thinking"),
      attentionKinds,
    ),
    "phase:tool": orderedSummaryItems(
      agents.filter((agent) => isAlive(agent) && attentionKinds.get(agent.pid) === "tool"),
      attentionKinds,
    ),
    issue: orderedSummaryItems(
      agents.filter(
        (agent) =>
          agent.status === "Stalled" || isPersistentUnmatched(agent, { nowSec: options.nowSec }),
      ),
      attentionKinds,
    ),
  } satisfies Record<SummaryPopupTarget, AgentSession[]>;

  return {
    attentionKinds,
    itemsByTarget,
    issueSections: buildIssueSections(agents, attentionKinds, options),
  };
}

export function selectSummaryPopupItems(
  agents: AgentSession[],
  target: SummaryPopupTarget,
  options: AttentionBuildOptions = {},
): AgentSession[] {
  return buildSummaryPopupDerivation(agents, options).itemsByTarget[target];
}

export function selectSummaryPopupItem(
  agents: AgentSession[],
  target: SummaryPopupTarget,
  selection: number,
  options: AttentionBuildOptions = {},
): AgentSession | undefined {
  if (!Number.isInteger(selection) || selection < 1) return undefined;
  return selectSummaryPopupItems(agents, target, options)[selection - 1];
}

export function buildSummaryPopupSelections(
  agents: AgentSession[],
  options: AttentionBuildOptions = {},
): SummaryPopupSelections {
  const { attentionKinds, itemsByTarget } = buildSummaryPopupDerivation(agents, options);
  return { attentionKinds, itemsByTarget };
}

export function summaryPopupTitle(target: SummaryPopupTarget, count: number): string {
  switch (target) {
    case "agent:claude":
      return `Claude Sessions (${count})`;
    case "agent:codex":
      return `Codex Sessions (${count})`;
    case "agent:gemini":
      return `Gemini Sessions (${count})`;
    case "idle":
      return `Idle Sessions (${count})`;
    case "phase:permission":
      return `Approval Waiting (${count})`;
    case "phase:thinking":
      return `Thinking Sessions (${count})`;
    case "phase:tool":
      return `Tool Sessions (${count})`;
    case "issue":
      return `Sessions Needing Review (${count})`;
  }
}

export function buildSummaryPopupSections(
  agents: AgentSession[],
  target: SummaryPopupTarget,
  options: AttentionBuildOptions = {},
  context?: SummaryPopupContext,
): SummaryPopupSection[] {
  return buildSummaryPopupView(agents, target, options, context).sections;
}

export function buildSummaryPopupView(
  agents: AgentSession[],
  target: SummaryPopupTarget,
  options: AttentionBuildOptions = {},
  context?: SummaryPopupContext,
): SummaryPopupView {
  const derivation = buildSummaryPopupDerivation(agents, options);
  const baseSections =
    target === "issue"
      ? derivation.issueSections
      : target === "idle"
        ? [
            {
              key: "all" as const,
              title: `Warm Idle (${derivation.itemsByTarget[target].filter((agent) => classifyIdleReuseBucket(agent, { nowSec: options.nowSec }) === "warm").length})`,
              items: orderedIdlePopupItems(
                derivation.itemsByTarget[target].filter(
                  (agent) => classifyIdleReuseBucket(agent, { nowSec: options.nowSec }) === "warm",
                ),
              ),
            },
            {
              key: "all" as const,
              title: `Cold Idle (${derivation.itemsByTarget[target].filter((agent) => classifyIdleReuseBucket(agent, { nowSec: options.nowSec }) === "cold").length})`,
              items: orderedIdlePopupItems(
                derivation.itemsByTarget[target].filter(
                  (agent) => classifyIdleReuseBucket(agent, { nowSec: options.nowSec }) === "cold",
                ),
              ),
            },
          ].filter((section) => section.items.length > 0)
        : [
            {
              key: "all" as const,
              title: `Primary Matches (${derivation.itemsByTarget[target].length})`,
              items: derivation.itemsByTarget[target],
            },
          ];
  const withContext = applySummaryPopupContext(baseSections, context);
  return {
    title: summaryPopupTitle(target, derivation.itemsByTarget[target].length),
    totalItems: derivation.itemsByTarget[target].length,
    sections: withContext.sections,
    markerByPid: withContext.markerByPid,
  };
}

export function buildSummaryPopupPage(
  agents: AgentSession[],
  target: SummaryPopupTarget,
  page: number,
  options: AttentionBuildOptions & { pageSize?: number; context?: SummaryPopupContext } = {},
): SummaryPopupPage {
  const pageSize =
    Number.isInteger(options.pageSize) && Number(options.pageSize) > 0
      ? Number(options.pageSize)
      : 10;
  const view = buildSummaryPopupView(agents, target, options, options.context);
  const sections = view.sections;
  const allItems = sections.flatMap((section) => section.items);
  const totalItems = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const pageItems = allItems.slice(startIndex, endIndex);
  const pagePidSet = new Set(pageItems.map((agent) => agent.pid));
  const pageSections = sections
    .map((section) => {
      const sectionItems = section.items.filter((agent) => pagePidSet.has(agent.pid));
      if (sectionItems.length === 0) return undefined;
      return {
        key: section.key,
        title: section.title,
        totalCount: section.items.length,
        items: sectionItems,
      } satisfies SummaryPopupPageSection;
    })
    .filter((section): section is SummaryPopupPageSection => section !== undefined);

  return {
    target,
    title: view.title.replace(/\(\d+\)$/, `(${totalItems})`),
    page: currentPage,
    pageSize,
    totalItems,
    totalPages,
    startIndex,
    items: pageItems,
    sections: pageSections,
    markerByPid: view.markerByPid,
  };
}
