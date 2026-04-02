import type { SummaryPopupTarget } from "../summary-popup/shared.js";
import { serializeSummaryRange } from "../summary-popup/shared.js";
import type { AgentSession, SessionPhase } from "../types.js";

/**
 * Pure utility functions for marmonitor.
 * Extracted for testability — no side effects, no I/O.
 */

/** Shorten home directory path with ~ */
export function shortenPath(path: string, home?: string): string {
  const h = home ?? process.env.HOME ?? "";
  return path.startsWith(h) ? `~${path.slice(h.length)}` : path;
}

/** Format elapsed time from epoch seconds to human-readable */
export function formatElapsed(epochSec?: number, now?: number): string {
  if (!epochSec) return "?";
  const current = now ?? Date.now() / 1000;
  const elapsed = current - epochSec;
  if (elapsed < 0) return "?";
  if (elapsed < 60) return `${Math.floor(elapsed)}s ago`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`;
  return `${Math.floor(elapsed / 86400)}d ago`;
}

/** Compact elapsed label for status bars/popups.
 *  e.g. 26s, 3m, 2h, 1d */
export function formatElapsedCompact(epochSec?: number, now?: number): string | undefined {
  if (!epochSec) return undefined;
  const current = now ?? Date.now() / 1000;
  const elapsed = current - epochSec;
  if (elapsed < 0) return undefined;
  if (elapsed < 60) return `${Math.floor(elapsed)}s`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h`;
  return `${Math.floor(elapsed / 86400)}d`;
}

/** Format token count (e.g. 1234 -> "1.2K", 1234567 -> "1.2M") */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Compact directory label for dock/focus display.
 *  Replaces $HOME with ~ first, then shows last 2 path segments.
 *  e.g. "/Users/macrent" → "~"
 *       "/Users/macrent/marmonitor" → "~/marmonitor"
 *       "/Users/macrent/Documents/vos/vos-data-service" → "vos/vos-data-service"
 *       "/Users/macrent/.ai/projects/vos" → "projects/vos" */
export function compactDirLabel(cwd: string): string {
  const home = process.env.HOME ?? "";
  const shortened = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  if (shortened === "~") return "~";
  const parts = shortened.split("/").filter(Boolean);
  if (parts.length <= 1) return parts[0] || cwd;
  return parts.slice(-2).join("/");
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);
  if (maxLength <= 3) return `${value.slice(0, maxLength - 1)}…`;
  const head = Math.ceil((maxLength - 1) / 2);
  const tail = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Compact directory label for narrow statusline surfaces.
 *  Preserves the last repo segment most aggressively and shortens parent first. */
export function compactStatuslineDirLabel(cwd: string, maxLength = 26): string {
  const label = compactDirLabel(cwd);
  if (label.length <= maxLength) return label;

  const [parent, base] = label.split("/", 2);
  if (!base) return truncateMiddle(label, maxLength);
  const parentLabel = parent.slice(0, 1);
  const baseBudget = maxLength - parentLabel.length - 1;
  return `${parentLabel}/${truncateMiddle(base, baseBudget)}`;
}

function statuslineRepoLabel(cwd: string): string {
  const label = compactDirLabel(cwd);
  const parts = label.split("/").filter(Boolean);
  return parts.at(-1) ?? label;
}

export function buildStatuslinePathLabels(
  items: Array<{ cwd: string }>,
  maxLength: number,
): string[] {
  const repoLabels = items.map((item) => statuslineRepoLabel(item.cwd));
  const cwdSets = new Map<string, Set<string>>();

  for (const [index, label] of repoLabels.entries()) {
    const existing = cwdSets.get(label) ?? new Set<string>();
    existing.add(items[index].cwd);
    cwdSets.set(label, existing);
  }

  return items.map((item, index) => {
    const repoLabel = repoLabels[index];
    if ((cwdSets.get(repoLabel)?.size ?? 0) <= 1) {
      return truncateMiddle(repoLabel, maxLength);
    }
    return compactStatuslineDirLabel(item.cwd, maxLength);
  });
}

export interface StatuslineDetailLayout {
  itemCount: number;
  pathMaxLength: number;
}

export function resolveStatuslineDetailLayout(
  width: number | undefined,
  maxCount: number,
): StatuslineDetailLayout {
  if (!width || width <= 0) {
    return { itemCount: maxCount, pathMaxLength: 26 };
  }

  if (width < 70) {
    return { itemCount: Math.min(maxCount, 1), pathMaxLength: 12 };
  }
  if (width < 90) {
    return { itemCount: Math.min(maxCount, 2), pathMaxLength: 14 };
  }
  if (width < 120) {
    return { itemCount: Math.min(maxCount, 3), pathMaxLength: 16 };
  }
  if (width < 150) {
    return { itemCount: Math.min(maxCount, 4), pathMaxLength: 20 };
  }

  return { itemCount: maxCount, pathMaxLength: 26 };
}

/** Encode cwd to Claude project directory name.
 *  Claude Code replaces both "/" and "." with "-". */
export function cwdToProjectDirName(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

/** Determine agent status from CPU, elapsed time, and session match state */
export function determineStatus(
  cpuPercent: number,
  elapsedSec: number | undefined,
  sessionMatched: boolean,
  activeCpuThreshold: number,
  stalledAfterMin: number,
  phase?: SessionPhase,
  recentActivityActiveSec = 180,
): "Active" | "Idle" | "Stalled" | "Unmatched" | "Dead" {
  if (!sessionMatched) return "Unmatched";
  if (cpuPercent > activeCpuThreshold) return "Active";
  if (
    (phase === "thinking" || phase === "tool" || phase === "permission") &&
    (elapsedSec === undefined || elapsedSec <= recentActivityActiveSec)
  ) {
    return "Active";
  }
  const stalledSec = stalledAfterMin * 60;
  if (elapsedSec !== undefined && elapsedSec > stalledSec && cpuPercent < 0.1) {
    return "Stalled";
  }
  return "Idle";
}

export interface CodexSessionCandidate {
  cwd: string;
  timestamp: number;
  lastActivityAt?: number;
}

const CODEX_SESSION_START_MATCH_MAX_SEC = 2 * 60 * 60;

function codexSessionRecency(session: CodexSessionCandidate): number {
  return session.lastActivityAt ?? session.timestamp;
}

/** Select the most plausible Codex session for a process.
 *  Prefer exact cwd match, then a plausibly close process-start timestamp.
 *  When the process is long-lived and the start time is no longer useful,
 *  fall back to the most recently active rollout instead. */
export function selectCodexSession<T extends CodexSessionCandidate>(
  processCwd: string,
  processStartTime: number | undefined,
  sessions: T[],
): T | undefined {
  const cwdMatches = sessions.filter((session) => session.cwd === processCwd);
  if (cwdMatches.length === 0) return undefined;
  if (cwdMatches.length === 1) return cwdMatches[0];

  const byRecency = [...cwdMatches].sort((a, b) => {
    const recencyDiff = codexSessionRecency(b) - codexSessionRecency(a);
    if (recencyDiff !== 0) return recencyDiff;
    return b.timestamp - a.timestamp;
  });

  if (processStartTime === undefined) {
    return byRecency[0];
  }

  const newestRecency = codexSessionRecency(byRecency[0]);
  if (newestRecency - processStartTime > CODEX_SESSION_START_MATCH_MAX_SEC) {
    return byRecency[0];
  }

  const byStartTime = [...cwdMatches].sort(
    (a, b) => Math.abs(a.timestamp - processStartTime) - Math.abs(b.timestamp - processStartTime),
  );
  const closest = byStartTime[0];
  const closestGap = Math.abs(closest.timestamp - processStartTime);
  if (closestGap <= CODEX_SESSION_START_MATCH_MAX_SEC) {
    return closest;
  }

  return byRecency[0];
}

/** Select unmatched processes that are eligible for cleanup. */
export function selectUnmatchedTargets(
  agents: AgentSession[],
  selectedPids?: number[],
): AgentSession[] {
  const unmatched = agents.filter((agent) => agent.status === "Unmatched");
  if (!selectedPids || selectedPids.length === 0) {
    return unmatched.sort((a, b) => a.pid - b.pid);
  }

  const selected = new Set(selectedPids);
  return unmatched.filter((agent) => selected.has(agent.pid)).sort((a, b) => a.pid - b.pid);
}

export interface StatuslineSnapshot {
  aliveCount: number;
  waitingCount: number;
  riskCount: number;
  stalledCount: number;
  unmatchedCount: number;
  activeCount: number;
  highCpuCount: number;
  thinkingCount?: number;
  toolCount?: number;
  claudeCount?: number;
  codexCount?: number;
  geminiCount?: number;
  cpuPercent?: number;
  memoryUsedGb?: number;
}

export type StatuslineFormat =
  | "compact"
  | "standard"
  | "extended"
  | "tmux-badges"
  | "wezterm-pills";

export type TmuxBadgeStyle = "plain" | "minimal" | "pill";

export type AttentionKind = "unmatched" | "permission" | "stalled" | "thinking" | "tool" | "active";

export interface AttentionItem {
  kind: AttentionKind;
  priority: number;
  pid: number;
  agentName: string;
  cwd: string;
  cpuPercent?: number;
  memoryMb?: number;
  startedAt?: number;
  runtimeSource?: AgentSession["runtimeSource"];
  status: AgentSession["status"];
  phase?: AgentSession["phase"];
  lastResponseAt?: number;
  lastActivityAt?: number;
  idleSince?: number;
  recentCompleteAt?: number;
}

export interface AttentionBuildOptions {
  nowSec?: number;
  phaseAttentionMaxAgeSec?: number;
}

const DEFAULT_PHASE_ATTENTION_MAX_AGE_SEC = 15 * 60;
const DEFAULT_RECENT_COMPLETE_MAX_AGE_SEC = 10 * 60;
const DEFAULT_WARM_IDLE_MIN_AGE_SEC = 10 * 60 + 1;
const DEFAULT_WARM_IDLE_MAX_AGE_SEC = 60 * 60 - 1;
const DEFAULT_PERSISTENT_UNMATCHED_GRACE_SEC = 2 * 60;

export interface StatuslineAttentionOptions {
  nowSec?: number;
  recentCompleteMaxAgeSec?: number;
  suppressedRepoLabels?: Set<string>;
}

export interface IdleRightRailEntry {
  pid: number;
  agent: "claude" | "codex";
  cwd: string;
  label: string;
  lastAt: number;
}

export interface IdleRightRailSnapshot {
  total: number;
  claudeCount: number;
  codexCount: number;
  entries: IdleRightRailEntry[];
}

export interface StatuslineAttentionRepresentative {
  kind: Exclude<AttentionKind, "unmatched" | "stalled">;
  pid: number;
  agentName: string;
  cwd: string;
  label: string;
  lastAt: number;
  collapsedCount: number;
  status: AgentSession["status"];
  phase: AgentSession["phase"];
  recentComplete: boolean;
  highlighted: boolean;
}

export interface StatuslineRealtimeView {
  snapshot: StatuslineSnapshot;
  attentionItems?: AttentionItem[];
  jumpItems?: AttentionItem[];
  idleSnapshot?: IdleRightRailSnapshot;
  suppressedRepoLabels?: Set<string>;
}

export interface StatuslineRealtimeViewOptions extends AttentionBuildOptions {
  includeFocusItems?: boolean;
  includeIdleSnapshot?: boolean;
}

const UNMATCHED_CURRENT_WORK_CPU_THRESHOLD = 0.5;

export function stripTmuxFormatting(text: string): string {
  return text.replace(/#\[[^\]]*]/g, "");
}

export function visibleTextWidth(text: string): number {
  return stripTmuxFormatting(text).length;
}

export interface StatusPill {
  label: string;
  fg: string;
  bg: string;
  summaryTarget?: SummaryPopupTarget;
}

export interface PhaseDecayConfig {
  thinking: number;
  tool: number;
  permission: number;
  done: number;
}

export interface JsonlCursorState {
  offset: number;
  remainder: string;
  recentLines: string[];
}

export interface PhaseHistoryEntry {
  phase: Exclude<SessionPhase, undefined>;
  at: number;
}

export interface SessionRegistryEntry {
  filePath: string;
  sessionId: string;
  cwd: string;
  firstSeenOffset: number;
  startedAt?: number;
  model?: string;
  source: "claude" | "codex";
}

export interface SessionFileCandidate {
  path: string;
  mtimeMs: number;
}

export function resolvePhaseWithDecay(
  currentPhase: SessionPhase,
  cachedPhase: SessionPhase,
  cachedDetectedAtMs: number | undefined,
  decay: PhaseDecayConfig,
  nowMs = Date.now(),
): SessionPhase {
  if (currentPhase) return currentPhase;
  if (!cachedPhase || cachedDetectedAtMs === undefined) return undefined;

  const decaySec = decay[cachedPhase];
  if (decaySec === 0) return cachedPhase;
  if (nowMs - cachedDetectedAtMs <= decaySec * 1000) return cachedPhase;
  return undefined;
}

export function advanceJsonlCursor(
  previous: JsonlCursorState,
  chunk: string,
  maxLines: number,
): JsonlCursorState {
  const merged = previous.remainder + chunk;
  const parts = merged.split("\n");
  const remainder = parts.pop() ?? "";
  const completeLines = parts.filter((line) => line.trim());
  const recentLines = [...previous.recentLines, ...completeLines].slice(-maxLines);

  return {
    offset: previous.offset + Buffer.byteLength(chunk),
    remainder,
    recentLines,
  };
}

export function detectApprovalPromptPhase(
  output: unknown,
  patterns = [
    "would you like to",
    "approve this",
    "approve the following",
    "confirm",
    "confirmation required",
  ],
  clearPatterns = [
    "reading files",
    "applying patch",
    "running tests",
    "running command",
    "edited",
    "changes applied",
  ],
): SessionPhase {
  if (!output || typeof output !== "string") return undefined;
  const recentLines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8);
  if (recentLines.length === 0) return undefined;
  const recentMatchIndex = recentLines.findIndex((line) => {
    const normalized = line.toLowerCase();
    return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
  });
  if (recentMatchIndex === -1) return undefined;

  const hasClearSignalAfterPrompt = recentLines.slice(recentMatchIndex + 1).some((line) => {
    const normalized = line.toLowerCase();
    return clearPatterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
  });
  if (hasClearSignalAfterPrompt) return undefined;

  const hasApprovalChoices = recentLines.slice(recentMatchIndex + 1).some((line) => {
    const normalized = line.toLowerCase();
    return (
      normalized.includes("allow once") ||
      normalized.includes("allow for this session") ||
      normalized.includes("no, suggest changes") ||
      normalized.includes("press 1") ||
      normalized.includes("press 1-9") ||
      /^\W*1\./.test(normalized)
    );
  });

  if (hasApprovalChoices) return "permission";
  return recentMatchIndex >= recentLines.length - 3 ? "permission" : undefined;
}

export function updatePhaseHistory(
  previousPhase: SessionPhase,
  previousHistory: PhaseHistoryEntry[],
  nextPhase: SessionPhase,
  at: number,
  maxEntries = 5,
): { previousPhase?: SessionPhase; history: PhaseHistoryEntry[] } {
  if (!nextPhase || nextPhase === previousPhase) {
    return {
      previousPhase,
      history: previousHistory,
    };
  }

  return {
    previousPhase,
    history: [...previousHistory, { phase: nextPhase, at }].slice(-maxEntries),
  };
}

export function resolvePhaseFromHistory(
  currentPhase: SessionPhase,
  history: PhaseHistoryEntry[],
  nowMs = Date.now(),
  maxAgeMs = 10_000,
): SessionPhase {
  if (currentPhase) return currentPhase;
  const last = history.at(-1);
  if (!last) return undefined;
  if (nowMs - last.at > maxAgeMs) return undefined;
  return last.phase;
}

export function resolveSessionRegistryPath(
  registry: Map<string, SessionRegistryEntry>,
  sessionId: string,
): string | undefined {
  return registry.get(sessionId)?.filePath;
}

export function upsertSessionRegistryEntry(
  registry: Map<string, SessionRegistryEntry>,
  entry: SessionRegistryEntry,
): void {
  registry.set(entry.sessionId, entry);
}

export function selectRecentSessionFile(
  candidates: SessionFileCandidate[],
  nowMs = Date.now(),
  maxAgeMs = 72 * 60 * 60 * 1000,
  minLeadMs = 5 * 60 * 1000,
): string | undefined {
  if (candidates.length === 0) return undefined;

  const sorted = [...candidates].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = sorted[0];
  const second = sorted[1];

  if (nowMs - latest.mtimeMs > maxAgeMs) return undefined;
  if (second && latest.mtimeMs - second.mtimeMs < minLeadMs) return undefined;

  return latest.path;
}

function agentShortName(agentName: string): string {
  if (agentName === "Claude Code") return "Cl";
  if (agentName === "Codex") return "Cx";
  if (agentName === "Gemini") return "Gm";
  return agentName;
}

function isRecentPhaseAttention(
  agent: Pick<AgentSession, "phase" | "lastActivityAt" | "lastResponseAt" | "startedAt">,
  nowSec: number,
  maxAgeSec: number,
): boolean {
  if (agent.phase !== "thinking" && agent.phase !== "tool") return false;
  const at = attentionActivityTime(agent);
  if (!at) return false;
  return nowSec - at <= maxAgeSec;
}

function attentionPriority(
  agent: AgentSession,
  nowSec: number,
  phaseAttentionMaxAgeSec: number,
): number | undefined {
  if (agent.phase === "permission") return 0;
  if (
    agent.phase === "thinking" &&
    isRecentPhaseAttention(agent, nowSec, phaseAttentionMaxAgeSec)
  ) {
    return 1;
  }
  return undefined;
}

function attentionKind(
  agent: AgentSession,
  nowSec: number,
  phaseAttentionMaxAgeSec: number,
): AttentionKind | undefined {
  if (agent.phase === "permission") return "permission";
  if (
    agent.phase === "thinking" &&
    isRecentPhaseAttention(agent, nowSec, phaseAttentionMaxAgeSec)
  ) {
    return "thinking";
  }
  if (agent.phase === "tool" && isRecentPhaseAttention(agent, nowSec, phaseAttentionMaxAgeSec)) {
    return "tool";
  }
  if (agent.status === "Dead" || agent.status === "Unmatched" || agent.status === "Stalled") {
    return undefined;
  }
  return "active";
}

function attentionActivityTime(
  agent: Pick<AgentSession, "lastActivityAt" | "lastResponseAt" | "startedAt">,
): number {
  return agent.lastActivityAt ?? agent.lastResponseAt ?? agent.startedAt ?? 0;
}

function unmatchedReferenceTime(
  agent: Pick<AgentSession, "startedAt" | "lastActivityAt" | "lastResponseAt">,
): number | undefined {
  return agent.startedAt ?? agent.lastActivityAt ?? agent.lastResponseAt;
}

function unmatchedAgeSec(
  agent: Pick<AgentSession, "startedAt" | "lastActivityAt" | "lastResponseAt">,
  nowSec: number,
): number | undefined {
  const at = unmatchedReferenceTime(agent);
  if (!at) return undefined;
  return Math.max(0, nowSec - at);
}

export function isPersistentUnmatched(
  agent: Pick<AgentSession, "status" | "startedAt" | "lastActivityAt" | "lastResponseAt">,
  options: { nowSec?: number; graceSec?: number } = {},
): boolean {
  if (agent.status !== "Unmatched") return false;
  const nowSec = options.nowSec ?? Date.now() / 1000;
  const graceSec = options.graceSec ?? DEFAULT_PERSISTENT_UNMATCHED_GRACE_SEC;
  const age = unmatchedAgeSec(agent, nowSec);
  if (age === undefined) return false;
  return age >= graceSec;
}

function idleReferenceTime(
  agent: Pick<AgentSession, "idleSince" | "lastActivityAt" | "lastResponseAt" | "startedAt">,
): number | undefined {
  return agent.idleSince ?? agent.lastActivityAt ?? agent.lastResponseAt ?? agent.startedAt;
}

function idleAgeSec(
  agent: Pick<AgentSession, "idleSince" | "lastActivityAt" | "lastResponseAt" | "startedAt">,
  nowSec: number,
): number | undefined {
  const idleAt = idleReferenceTime(agent);
  if (!idleAt) return undefined;
  return Math.max(0, nowSec - idleAt);
}

function isRecentCompleteSession(
  agent: Pick<AgentSession, "status" | "recentCompleteAt">,
  nowSec: number,
  recentCompleteMaxAgeSec: number,
): boolean {
  if (agent.status !== "Idle" || !agent.recentCompleteAt) return false;
  return Math.max(0, nowSec - agent.recentCompleteAt) <= recentCompleteMaxAgeSec;
}

export function isIdleRightRailCandidate(
  agent: AgentSession,
  options: { nowSec?: number } = {},
): boolean {
  const nowSec = options.nowSec ?? Date.now() / 1000;
  const supportedAgent = agent.agentName === "Claude Code" || agent.agentName === "Codex";
  if (!supportedAgent) return false;
  if (agent.status !== "Idle") return false;
  if (agent.phase === "permission" || agent.phase === "thinking" || agent.phase === "tool") {
    return false;
  }
  if (isRecentCompleteSession(agent, nowSec, DEFAULT_RECENT_COMPLETE_MAX_AGE_SEC)) return false;
  const age = idleAgeSec(agent, nowSec);
  if (age === undefined) return false;
  return age >= DEFAULT_WARM_IDLE_MIN_AGE_SEC && age <= DEFAULT_WARM_IDLE_MAX_AGE_SEC;
}

export function selectIdleSessionsForRightRail(
  agents: AgentSession[],
  options: { nowSec?: number } = {},
): IdleRightRailSnapshot {
  const nowSec = options.nowSec ?? Date.now() / 1000;
  const idleAgents = agents
    .filter((agent) => isIdleRightRailCandidate(agent, { nowSec }))
    .sort((a, b) => {
      const idleDiff = (idleReferenceTime(b) ?? 0) - (idleReferenceTime(a) ?? 0);
      if (idleDiff !== 0) return idleDiff;
      const activityDiff = attentionActivityTime(b) - attentionActivityTime(a);
      if (activityDiff !== 0) return activityDiff;
      const agentDiff = a.agentName.localeCompare(b.agentName);
      if (agentDiff !== 0) return agentDiff;
      return a.pid - b.pid;
    });

  const labels = buildStatuslinePathLabels(idleAgents, 22);
  const entries: IdleRightRailEntry[] = idleAgents.map((agent, index) => ({
    pid: agent.pid,
    agent: agent.agentName === "Claude Code" ? "claude" : "codex",
    cwd: agent.cwd,
    label: labels[index],
    lastAt: idleReferenceTime(agent) ?? attentionActivityTime(agent),
  }));

  return {
    total: entries.length,
    claudeCount: entries.filter((entry) => entry.agent === "claude").length,
    codexCount: entries.filter((entry) => entry.agent === "codex").length,
    entries,
  };
}

export function buildStatuslineRealtimeView(
  agents: AgentSession[],
  options: StatuslineRealtimeViewOptions = {},
): StatuslineRealtimeView {
  const nowSec = options.nowSec ?? Date.now() / 1000;
  const alive = agents.filter((agent) => agent.status !== "Dead" && agent.status !== "Unmatched");
  const snapshot: StatuslineSnapshot = {
    aliveCount: alive.length,
    waitingCount: alive.filter((agent) => agent.phase === "permission").length,
    riskCount: 0,
    stalledCount: alive.filter((agent) => agent.status === "Stalled").length,
    unmatchedCount: agents.filter((agent) => isPersistentUnmatched(agent, { nowSec })).length,
    activeCount: alive.filter((agent) => agent.status === "Active").length,
    highCpuCount: alive.filter((agent) => agent.cpuPercent >= 10).length,
    claudeCount: alive.filter((agent) => agent.agentName === "Claude Code").length,
    codexCount: alive.filter((agent) => agent.agentName === "Codex").length,
    geminiCount: alive.filter((agent) => agent.agentName === "Gemini").length,
  };

  let attentionItems: AttentionItem[] | undefined;
  let jumpItems: AttentionItem[] | undefined;
  let suppressedRepoLabels: Set<string> | undefined;
  if (options.includeFocusItems) {
    attentionItems = buildAttentionItems(agents, options);
    jumpItems = orderedAttentionItems(attentionItems);
    suppressedRepoLabels = buildSuppressedStatuslineRepoLabels(agents);
    snapshot.waitingCount = attentionItems.filter((item) => item.kind === "permission").length;
    snapshot.thinkingCount = attentionItems.filter((item) => item.kind === "thinking").length;
    snapshot.toolCount = attentionItems.filter((item) => item.kind === "tool").length;
  }

  return {
    snapshot,
    attentionItems,
    jumpItems,
    idleSnapshot: options.includeIdleSnapshot
      ? selectIdleSessionsForRightRail(agents, { nowSec })
      : undefined,
    suppressedRepoLabels,
  };
}

function buildIdleRightRailCounts(snapshot: IdleRightRailSnapshot): string[] {
  const parts: string[] = [];
  if (snapshot.claudeCount > 0) parts.push(`Cl${snapshot.claudeCount}`);
  if (snapshot.codexCount > 0) parts.push(`Cx${snapshot.codexCount}`);
  return parts;
}

const STATUSLINE_EMPTY_FOCUS_LABEL = "no focus";
const WARM_IDLE_RAIL_PREFIX = "warm";
const WARM_IDLE_EMPTY_LABEL = `${WARM_IDLE_RAIL_PREFIX} -`;

type IdleRightRailVariant =
  | { kind: "full"; countLabel: string; names: IdleRightRailEntry[] }
  | { kind: "compact"; countLabel: string }
  | { kind: "minimal" }
  | { kind: "empty" };

function formatIdleRightRailEntry(entry: IdleRightRailEntry): string {
  const time = formatElapsedCompact(entry.lastAt);
  return time ? `${entry.label} ${time}` : entry.label;
}

function resolveIdleRightRailVariant(
  snapshot: IdleRightRailSnapshot,
  width: number | undefined,
  availableWidth: number,
): IdleRightRailVariant | undefined {
  if (!width || width < 90 || availableWidth <= 0) {
    return undefined;
  }
  if (snapshot.total === 0) {
    return visibleTextWidth(WARM_IDLE_EMPTY_LABEL) <= availableWidth
      ? { kind: "empty" }
      : undefined;
  }

  const countParts = buildIdleRightRailCounts(snapshot);
  const countLabel = countParts.length > 0 ? countParts.join(" ") : String(snapshot.total);
  const nameLimit = snapshot.total <= 5 ? 5 : width < 160 ? 2 : 3;
  const names = snapshot.entries.slice(0, nameLimit);
  const fullPlain =
    names.length > 0
      ? `${WARM_IDLE_RAIL_PREFIX} ${countLabel} | ${names.map((entry) => formatIdleRightRailEntry(entry)).join(" · ")}`
      : `${WARM_IDLE_RAIL_PREFIX} ${countLabel}`;
  const compactPlain = `${WARM_IDLE_RAIL_PREFIX} ${countLabel}`;
  const minimalPlain = `${WARM_IDLE_RAIL_PREFIX} ${snapshot.total}`;

  if (visibleTextWidth(fullPlain) <= availableWidth) {
    return { kind: "full", countLabel, names };
  }
  if (visibleTextWidth(compactPlain) <= availableWidth) {
    return { kind: "compact", countLabel };
  }
  if (visibleTextWidth(minimalPlain) <= availableWidth) {
    return { kind: "minimal" };
  }
  return undefined;
}

export function buildIdleRightRail(
  snapshot: IdleRightRailSnapshot,
  width: number | undefined,
  availableWidth: number,
): string | undefined {
  const variant = resolveIdleRightRailVariant(snapshot, width, availableWidth);
  if (!variant) return undefined;
  if (variant.kind === "empty") {
    return WARM_IDLE_EMPTY_LABEL;
  }
  if (variant.kind === "minimal") {
    return `${WARM_IDLE_RAIL_PREFIX} ${snapshot.total}`;
  }
  if (variant.kind === "compact") {
    return `${WARM_IDLE_RAIL_PREFIX} ${variant.countLabel}`;
  }
  return `${WARM_IDLE_RAIL_PREFIX} ${variant.countLabel} | ${variant.names.map((entry) => formatIdleRightRailEntry(entry)).join(" · ")}`;
}

export function makeTmuxSummaryRange(target: SummaryPopupTarget, content: string): string {
  return tmuxUserRange(serializeSummaryRange(target), content);
}

export function buildTmuxIdleRightRail(
  snapshot: IdleRightRailSnapshot,
  width: number | undefined,
  availableWidth: number,
): string | undefined {
  const variant = resolveIdleRightRailVariant(snapshot, width, availableWidth);
  if (!variant) return undefined;
  if (variant.kind === "empty") {
    return makeTmuxSummaryRange("idle", WARM_IDLE_EMPTY_LABEL);
  }
  if (variant.kind === "minimal") {
    return makeTmuxSummaryRange("idle", `${WARM_IDLE_RAIL_PREFIX} ${snapshot.total}`);
  }
  if (variant.kind === "compact") {
    return makeTmuxSummaryRange("idle", `${WARM_IDLE_RAIL_PREFIX} ${variant.countLabel}`);
  }

  const summary = makeTmuxSummaryRange("idle", `${WARM_IDLE_RAIL_PREFIX} ${variant.countLabel}`);
  const names = variant.names
    .map((entry) => tmuxUserRange(`pid:${entry.pid}`, formatIdleRightRailEntry(entry)))
    .join(" · ");
  return names ? `${summary} | ${names}` : summary;
}

export function joinLeftAndRightRail(
  left: string,
  right: string | undefined,
  width: number | undefined,
  gap = 2,
): string {
  if (!right || !width || width <= 0) return left;
  const leftWidth = visibleTextWidth(left);
  const rightWidth = visibleTextWidth(right);
  const spaceBudget = width - leftWidth - rightWidth;
  if (spaceBudget < gap) return left;
  return `${left}${" ".repeat(spaceBudget)}${right}`;
}

function orderedAttentionItems(items: AttentionItem[]): AttentionItem[] {
  const tier1Order: Partial<Record<AttentionKind, number>> = {
    permission: 0,
    thinking: 1,
  };

  return [...items].sort((a, b) => {
    const aTier1 = tier1Order[a.kind];
    const bTier1 = tier1Order[b.kind];

    if (aTier1 !== undefined || bTier1 !== undefined) {
      if (aTier1 === undefined) return 1;
      if (bTier1 === undefined) return -1;
      if (aTier1 !== bTier1) return aTier1 - bTier1;
      return attentionActivityTime(b) - attentionActivityTime(a);
    }

    return attentionActivityTime(b) - attentionActivityTime(a);
  });
}

function hasUnmatchedCurrentWork(agent: AgentSession): boolean {
  if (agent.status !== "Unmatched") return false;
  if (agent.unmatchedReason === "startup_grace") return false;
  if (agent.phase === "permission" || agent.phase === "thinking" || agent.phase === "tool") {
    return true;
  }
  if (agent.cpuPercent > UNMATCHED_CURRENT_WORK_CPU_THRESHOLD) {
    return true;
  }
  if (agent.workers?.some((worker) => worker.cpuPercent > UNMATCHED_CURRENT_WORK_CPU_THRESHOLD)) {
    return true;
  }
  return false;
}

function buildSuppressedStatuslineRepoLabels(agents: AgentSession[]): Set<string> {
  const suppressed = new Set<string>();
  for (const agent of agents) {
    if (!hasUnmatchedCurrentWork(agent)) continue;
    suppressed.add(statuslineRepoLabel(agent.cwd));
  }
  return suppressed;
}

/** Build prioritized attention list for popup/jump UX.
 * Order: permission -> thinking -> recently active alive sessions. */
export function buildAttentionItems(
  agents: AgentSession[],
  options: AttentionBuildOptions = {},
): AttentionItem[] {
  const nowSec = options.nowSec ?? Date.now() / 1000;
  const phaseAttentionMaxAgeSec =
    options.phaseAttentionMaxAgeSec ?? DEFAULT_PHASE_ATTENTION_MAX_AGE_SEC;
  const alive = agents.filter(
    (agent) =>
      agent.status !== "Dead" && agent.status !== "Unmatched" && agent.status !== "Stalled",
  );

  const toAttentionItem = (
    agent: AgentSession,
    priority: number,
    kind: AttentionKind,
  ): AttentionItem => ({
    kind,
    priority,
    pid: agent.pid,
    agentName: agent.agentName,
    cwd: agent.cwd,
    cpuPercent: agent.cpuPercent,
    memoryMb: agent.memoryMb,
    startedAt: agent.startedAt,
    runtimeSource: agent.runtimeSource,
    status: agent.status,
    phase: agent.phase,
    lastResponseAt: agent.lastResponseAt,
    lastActivityAt: agent.lastActivityAt,
    idleSince: agent.idleSince,
    recentCompleteAt: agent.recentCompleteAt,
  });

  const tier1 = alive
    .filter((agent) => attentionPriority(agent, nowSec, phaseAttentionMaxAgeSec) !== undefined)
    .sort((a, b) => {
      const aPriority =
        attentionPriority(a, nowSec, phaseAttentionMaxAgeSec) ?? Number.MAX_SAFE_INTEGER;
      const bPriority =
        attentionPriority(b, nowSec, phaseAttentionMaxAgeSec) ?? Number.MAX_SAFE_INTEGER;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return attentionActivityTime(b) - attentionActivityTime(a);
    })
    .map((agent) =>
      toAttentionItem(
        agent,
        attentionPriority(agent, nowSec, phaseAttentionMaxAgeSec) ?? 0,
        attentionKind(agent, nowSec, phaseAttentionMaxAgeSec) ?? "active",
      ),
    );

  const tier1Pids = new Set(tier1.map((item) => item.pid));
  const tier2 = alive
    .filter((agent) => !tier1Pids.has(agent.pid))
    .sort((a, b) => attentionActivityTime(b) - attentionActivityTime(a))
    .map((agent) =>
      toAttentionItem(agent, 2, attentionKind(agent, nowSec, phaseAttentionMaxAgeSec) ?? "active"),
    );

  return [...tier1, ...tier2];
}

export function selectAttentionItem(
  agents: AgentSession[],
  selection: number,
  options: AttentionBuildOptions = {},
): AttentionItem | undefined {
  if (!Number.isInteger(selection) || selection < 1) return undefined;
  return buildAttentionItems(agents, options)[selection - 1];
}

/** Build jumpable attention items for interactive navigation.
 *  Statusline/jump share the same top-of-mind ordering. */
export function buildJumpAttentionItems(
  agents: AgentSession[],
  options: AttentionBuildOptions = {},
): AttentionItem[] {
  return orderedAttentionItems(buildAttentionItems(agents, options));
}

function isRecentCompleteAttention(
  item: AttentionItem,
  nowSec: number,
  recentCompleteMaxAgeSec: number,
): boolean {
  if (item.kind !== "active" || item.status !== "Idle") return false;
  return isRecentCompleteSession(item, nowSec, recentCompleteMaxAgeSec);
}

function collapseStatuslineAttentionDuplicates(
  items: AttentionItem[],
  maxLabelLength: number,
): StatuslineAttentionRepresentative[] {
  const grouped = new Map<string, AttentionItem[]>();
  for (const item of items) {
    const key = statuslineRepoLabel(item.cwd);
    const existing = grouped.get(key) ?? [];
    existing.push(item);
    grouped.set(key, existing);
  }

  return [...grouped.entries()]
    .map(([repoLabel, groupedItems]) => {
      const sorted = [...groupedItems].sort((a, b) => {
        const activityDiff = attentionActivityTime(b) - attentionActivityTime(a);
        if (activityDiff !== 0) return activityDiff;
        const agentDiff = a.agentName.localeCompare(b.agentName);
        if (agentDiff !== 0) return agentDiff;
        return a.pid - b.pid;
      });
      const representative = sorted[0];
      const suffix = sorted.length > 1 ? ` +${sorted.length - 1}` : "";
      return {
        kind: representative.kind as Exclude<AttentionKind, "unmatched" | "stalled">,
        pid: representative.pid,
        agentName: representative.agentName,
        cwd: representative.cwd,
        label: truncateMiddle(`${repoLabel}${suffix}`, maxLabelLength),
        lastAt: representative.recentCompleteAt ?? attentionActivityTime(representative),
        collapsedCount: sorted.length - 1,
        status: representative.status,
        phase: representative.phase,
        recentComplete: true,
        highlighted: false,
      } satisfies StatuslineAttentionRepresentative;
    })
    .sort((a, b) => {
      const activityDiff = b.lastAt - a.lastAt;
      if (activityDiff !== 0) return activityDiff;
      const agentDiff = a.agentName.localeCompare(b.agentName);
      if (agentDiff !== 0) return agentDiff;
      return a.pid - b.pid;
    });
}

function compareImmediateDuplicateCandidates(a: AttentionItem, b: AttentionItem): number {
  if (a.status !== b.status) {
    if (a.status === "Active") return -1;
    if (b.status === "Active") return 1;
  }
  const activityDiff = attentionActivityTime(b) - attentionActivityTime(a);
  if (activityDiff !== 0) return activityDiff;
  const agentDiff = a.agentName.localeCompare(b.agentName);
  if (agentDiff !== 0) return agentDiff;
  return a.pid - b.pid;
}

function collapseImmediateStatuslineDuplicates(
  items: AttentionItem[],
  maxLabelLength: number,
): StatuslineAttentionRepresentative[] {
  const grouped = new Map<string, AttentionItem[]>();
  for (const item of items) {
    const key = `${item.kind}:${statuslineRepoLabel(item.cwd)}`;
    const existing = grouped.get(key) ?? [];
    existing.push(item);
    grouped.set(key, existing);
  }

  const kindOrder: Record<Exclude<AttentionKind, "active" | "unmatched" | "stalled">, number> = {
    permission: 0,
    thinking: 1,
    tool: 2,
  };

  return [...grouped.values()]
    .map((groupedItems) => {
      const sorted = [...groupedItems].sort(compareImmediateDuplicateCandidates);
      const representative = sorted[0];
      const repoLabel = statuslineRepoLabel(representative.cwd);
      const suffix = sorted.length > 1 ? ` +${sorted.length - 1}` : "";
      return {
        kind: representative.kind as Exclude<AttentionKind, "active" | "unmatched" | "stalled">,
        pid: representative.pid,
        agentName: representative.agentName,
        cwd: representative.cwd,
        label: truncateMiddle(`${repoLabel}${suffix}`, maxLabelLength),
        lastAt: attentionActivityTime(representative),
        collapsedCount: sorted.length - 1,
        status: representative.status,
        phase: representative.phase,
        recentComplete: false,
        highlighted: representative.kind === "permission",
      } satisfies StatuslineAttentionRepresentative;
    })
    .sort((a, b) => {
      const priorityDiff = kindOrder[a.kind] - kindOrder[b.kind];
      if (priorityDiff !== 0) return priorityDiff;
      const activityDiff = b.lastAt - a.lastAt;
      if (activityDiff !== 0) return activityDiff;
      return a.pid - b.pid;
    });
}

export function buildStatuslineAttentionRepresentatives(
  items: AttentionItem[],
  maxCount = 5,
  width?: number,
  options: StatuslineAttentionOptions = {},
): StatuslineAttentionRepresentative[] {
  if (maxCount <= 0 || items.length === 0) return [];
  const nowSec = options.nowSec ?? Date.now() / 1000;
  const recentCompleteMaxAgeSec =
    options.recentCompleteMaxAgeSec ?? DEFAULT_RECENT_COMPLETE_MAX_AGE_SEC;
  const suppressedRepoLabels = options.suppressedRepoLabels ?? new Set<string>();
  const layout = resolveStatuslineDetailLayout(width, maxCount);

  const immediate = collapseImmediateStatuslineDuplicates(
    items.filter(
      (item) => item.kind === "permission" || item.kind === "thinking" || item.kind === "tool",
    ),
    layout.pathMaxLength,
  );

  const recentComplete = collapseStatuslineAttentionDuplicates(
    items.filter(
      (item) =>
        isRecentCompleteAttention(item, nowSec, recentCompleteMaxAgeSec) &&
        !suppressedRepoLabels.has(statuslineRepoLabel(item.cwd)),
    ),
    layout.pathMaxLength,
  );

  const recentCompleteReserve = recentComplete.length > 0 ? 1 : 0;
  const immediateBudget = Math.max(0, layout.itemCount - recentCompleteReserve);
  const selectedImmediate = immediate.slice(0, immediateBudget);
  const recentCompleteBudget = Math.max(0, layout.itemCount - selectedImmediate.length);
  const selectedRecentComplete = recentComplete.slice(0, recentCompleteBudget);
  let rawItems = [...selectedImmediate, ...selectedRecentComplete];
  const selectedPids = new Set(rawItems.map((item) => item.pid));
  const selectedRepoKeys = new Set(rawItems.map((item) => statuslineRepoLabel(item.cwd)));
  const activeFallbackItems = orderedAttentionItems(items)
    .filter(
      (item): item is AttentionItem & { kind: "active" } =>
        item.kind === "active" &&
        item.status === "Active" &&
        !selectedPids.has(item.pid) &&
        !selectedRepoKeys.has(statuslineRepoLabel(item.cwd)) &&
        !suppressedRepoLabels.has(statuslineRepoLabel(item.cwd)),
    )
    .slice(0, Math.max(0, layout.itemCount - rawItems.length));
  const fallbackLabels = buildStatuslinePathLabels(activeFallbackItems, layout.pathMaxLength);
  rawItems = [
    ...rawItems,
    ...activeFallbackItems.map((item, index) => ({
      kind: item.kind,
      pid: item.pid,
      agentName: item.agentName,
      cwd: item.cwd,
      label: fallbackLabels[index] ?? compactStatuslineDirLabel(item.cwd, layout.pathMaxLength),
      lastAt: attentionActivityTime(item),
      collapsedCount: 0,
      status: item.status,
      phase: item.phase,
      recentComplete: false,
      highlighted: false,
    })),
  ];
  if (rawItems.length === 0) return [];

  const unresolved = rawItems.filter((item) => item.kind !== "active");
  const pathLabels = buildStatuslinePathLabels(unresolved, layout.pathMaxLength);
  let pathIndex = 0;

  return rawItems.map((item) => {
    if (item.kind === "active") return item;
    if (item.label) return item;
    const label =
      pathLabels[pathIndex] ?? compactStatuslineDirLabel(item.cwd, layout.pathMaxLength);
    pathIndex += 1;
    return { ...item, label };
  });
}

export function selectJumpAttentionItem(
  agents: AgentSession[],
  selection: number,
  options: AttentionBuildOptions = {},
): AttentionItem | undefined {
  if (!Number.isInteger(selection) || selection < 1) return undefined;
  return buildJumpAttentionItems(agents, options)[selection - 1];
}

export function buildAttentionFocusText(
  items: AttentionItem[],
  maxCount = 3,
  width?: number,
): string | undefined {
  if (maxCount <= 0 || items.length === 0) return undefined;
  const layout = resolveStatuslineDetailLayout(width, maxCount);
  const detailItems = orderedAttentionItems(items)
    .filter((item) => item.kind !== "unmatched" && item.kind !== "stalled")
    .slice(0, layout.itemCount);
  const pathLabels = buildStatuslinePathLabels(detailItems, layout.pathMaxLength);

  const segments: string[] = [];
  for (const [index, item] of detailItems.entries()) {
    const agent = agentShortName(item.agentName);
    const path = pathLabels[index];
    const time = formatElapsedCompact(item.lastActivityAt ?? item.lastResponseAt);
    if (item.kind === "permission") {
      segments.push(`⏳${agent} ${path} allow`);
    } else if (item.kind === "stalled") {
      segments.push(time ? `⚠${agent} ${path} ${time}` : `⚠${agent} ${path}`);
    } else if (item.kind === "thinking") {
      segments.push(time ? `🤔${agent} ${path} ${time}` : `🤔${agent} ${path}`);
    } else if (item.kind === "tool") {
      segments.push(time ? `🔧${agent} ${path} ${time}` : `🔧${agent} ${path}`);
    } else if (item.kind === "active") {
      const donePrefix = item.phase === "done" ? "✓" : "";
      segments.push(
        time ? `${donePrefix}${agent} ${path} ${time}` : `${donePrefix}${agent} ${path}`,
      );
    }
  }

  return segments.length > 0 ? segments.join(" │ ") : undefined;
}

export function buildStatuslineAttentionFocusText(
  items: AttentionItem[],
  maxCount = 3,
  width?: number,
  options: StatuslineAttentionOptions = {},
): string | undefined {
  const detailItems = buildStatuslineAttentionRepresentatives(items, maxCount, width, options);
  if (detailItems.length === 0) return undefined;

  const segments = detailItems.map((item) => formatStatuslineRepresentativeLabel(item));

  return segments.length > 0 ? segments.join(" │ ") : undefined;
}

function formatStatuslineRepresentativeLabel(item: StatuslineAttentionRepresentative): string {
  const agent = agentShortName(item.agentName);
  const time = formatElapsedCompact(item.lastAt);

  if (item.kind === "permission") {
    return `⏳${agent} ${item.label} allow`;
  }
  if (item.kind === "thinking") {
    return time ? `🤔${agent} ${item.label} ${time}` : `🤔${agent} ${item.label}`;
  }
  if (item.kind === "tool") {
    return time ? `🔧${agent} ${item.label} ${time}` : `🔧${agent} ${item.label}`;
  }
  if (item.recentComplete) {
    return time ? `✅${agent} ${item.label} ${time}` : `✅${agent} ${item.label}`;
  }
  if (item.phase === "done") {
    return time ? `✓${agent} ${item.label} ${time}` : `✓${agent} ${item.label}`;
  }
  return time ? `${agent} ${item.label} ${time}` : `${agent} ${item.label}`;
}

export function buildTmuxBadgeSummary(snapshot: StatuslineSnapshot): string {
  const issueCount = snapshot.stalledCount + snapshot.unmatchedCount;
  const agentBadges = [];
  if ((snapshot.claudeCount ?? 0) > 0) agentBadges.push(`Cl ${snapshot.claudeCount}`);
  if ((snapshot.codexCount ?? 0) > 0) agentBadges.push(`Cx ${snapshot.codexCount}`);
  if ((snapshot.geminiCount ?? 0) > 0) agentBadges.push(`Gm ${snapshot.geminiCount}`);
  if (agentBadges.length === 0) agentBadges.push(`AI ${snapshot.aliveCount}`);

  const attentionBadges = [];
  if (snapshot.waitingCount > 0) attentionBadges.push(`⏳ ${snapshot.waitingCount}`);
  if (issueCount > 0) {
    attentionBadges.push(`⚠ ${issueCount}`);
  }
  if ((snapshot.thinkingCount ?? 0) > 0) attentionBadges.push(`🤔 ${snapshot.thinkingCount}`);
  if ((snapshot.toolCount ?? 0) > 0) attentionBadges.push(`🔧 ${snapshot.toolCount}`);

  if (attentionBadges.length === 0) {
    attentionBadges.push(`✅ ${snapshot.activeCount}`);
  }

  return `${agentBadges.join("  ")}   ${attentionBadges.join("  ")}`;
}

export function buildStatusPills(snapshot: StatuslineSnapshot): {
  agents: StatusPill[];
  alerts: StatusPill[];
} {
  const issueCount = snapshot.stalledCount + snapshot.unmatchedCount;
  const agents: StatusPill[] = [];
  if ((snapshot.claudeCount ?? 0) > 0) {
    agents.push({
      label: `Cl ${snapshot.claudeCount}`,
      fg: "#1e1e2e",
      bg: "#fab387",
      summaryTarget: "agent:claude",
    });
  }
  if ((snapshot.codexCount ?? 0) > 0) {
    agents.push({
      label: `Cx ${snapshot.codexCount}`,
      fg: "#1e1e2e",
      bg: "#94e2d5",
      summaryTarget: "agent:codex",
    });
  }
  if ((snapshot.geminiCount ?? 0) > 0) {
    agents.push({
      label: `Gm ${snapshot.geminiCount}`,
      fg: "#1e1e2e",
      bg: "#89b4fa",
      summaryTarget: "agent:gemini",
    });
  }
  if (agents.length === 0) {
    agents.push({ label: `AI ${snapshot.aliveCount}`, fg: "#1e1e2e", bg: "#cba6f7" });
  }

  const alerts: StatusPill[] = [];
  if (snapshot.waitingCount > 0) {
    alerts.push({
      label: `⏳ ${snapshot.waitingCount}`,
      fg: "#11111b",
      bg: "#f38ba8",
      summaryTarget: "phase:permission",
    });
  }
  if (issueCount > 0) {
    alerts.push({
      label: `⚠ ${issueCount}`,
      fg: "#11111b",
      bg: "#f9e2af",
      summaryTarget: "issue",
    });
  }
  if ((snapshot.thinkingCount ?? 0) > 0) {
    alerts.push({
      label: `🤔 ${snapshot.thinkingCount}`,
      fg: "#11111b",
      bg: "#cba6f7",
      summaryTarget: "phase:thinking",
    });
  }
  if ((snapshot.toolCount ?? 0) > 0) {
    alerts.push({
      label: `🔧 ${snapshot.toolCount}`,
      fg: "#11111b",
      bg: "#a6e3a1",
      summaryTarget: "phase:tool",
    });
  }
  if (alerts.length === 0) {
    alerts.push({ label: `✅ ${snapshot.activeCount}`, fg: "#11111b", bg: "#a6e3a1" });
  }

  return { agents, alerts };
}

/** Build one-line persistent-bar summary string. */
export function buildStatuslineSummary(
  snapshot: StatuslineSnapshot,
  format: StatuslineFormat = "compact",
): string {
  if (format === "tmux-badges" || format === "wezterm-pills") {
    return buildTmuxBadgeSummary(snapshot);
  }

  const compactParts = [`AI${snapshot.aliveCount}`];
  const standardParts = [`AI ${snapshot.aliveCount}`];

  if (snapshot.waitingCount > 0) {
    compactParts.push(`!${snapshot.waitingCount}`);
    standardParts.push(`wait ${snapshot.waitingCount}`);
  }
  if (snapshot.stalledCount > 0) {
    compactParts.push(`S${snapshot.stalledCount}`);
    standardParts.push(`stalled ${snapshot.stalledCount}`);
  }
  if (snapshot.unmatchedCount > 0) {
    compactParts.push(`O${snapshot.unmatchedCount}`);
    standardParts.push(`orphan ${snapshot.unmatchedCount}`);
  }

  if (format === "extended") {
    if (snapshot.activeCount > 0) standardParts.push(`active ${snapshot.activeCount}`);
    if (snapshot.highCpuCount > 0) standardParts.push(`hot ${snapshot.highCpuCount}`);
  }

  if (snapshot.waitingCount === 0 && snapshot.stalledCount === 0 && snapshot.unmatchedCount === 0) {
    compactParts.push("ok");
    standardParts.push("ok");
  }

  if (format === "compact") {
    const metrics = [];
    if (snapshot.cpuPercent !== undefined) metrics.push(`${snapshot.cpuPercent.toFixed(0)}%`);
    if (snapshot.memoryUsedGb !== undefined) metrics.push(`${snapshot.memoryUsedGb}G`);
    return metrics.length > 0
      ? `${compactParts.join(" ")} | ${metrics.join(" ")}`
      : compactParts.join(" ");
  }

  const metrics = [];
  if (snapshot.cpuPercent !== undefined) metrics.push(`CPU ${snapshot.cpuPercent.toFixed(0)}%`);
  if (format === "extended" && snapshot.memoryUsedGb !== undefined) {
    metrics.push(`MEM ${snapshot.memoryUsedGb}G`);
  }
  if (metrics.length > 0) standardParts.push(...metrics);

  return standardParts.join(" | ");
}

function tmuxPill(label: string, fg: string, bg: string): string {
  return `#[fg=${bg},bg=#1e1e2e]#[bold,fg=${fg},bg=${bg}] ${label} #[fg=${bg},bg=#1e1e2e]#[default]`;
}

function tmuxTextAccent(label: string, color: string): string {
  return `#[fg=${color}]${label}#[default]`;
}

function tmuxUserRange(value: string, content: string): string {
  return `#[range=user|${value}]${content}#[norange]`;
}

function tmuxDetailBlock(label: string): string {
  return `#[fg=#cdd6f4,bg=#313244] ${label} #[fg=#313244,bg=#1e1e2e]#[default]`;
}

function attentionBg(kind: Exclude<AttentionKind, "unmatched">): string {
  if (kind === "permission") return "#f38ba8";
  if (kind === "thinking") return "#cba6f7";
  if (kind === "tool") return "#a6e3a1";
  if (kind === "active") return "#6ee7b7";
  return "#f9e2af";
}

function tmuxAttentionSegment(
  index: number,
  kind: Exclude<AttentionKind, "unmatched">,
  label: string,
): string {
  const bg = attentionBg(kind);
  return `#[fg=${bg},bg=#1e1e2e]#[bold,fg=#11111b,bg=${bg}] ${index} #[fg=#313244,bg=${bg}]#[fg=#cdd6f4,bg=#313244] ${label} #[fg=#313244,bg=#1e1e2e]#[default]`;
}

function tmuxAttentionSegmentMinimal(
  index: number,
  kind: Exclude<AttentionKind, "unmatched">,
  label: string,
): string {
  return tmuxTextAccent(`${index} ${label}`, attentionBg(kind));
}

function emphasizeTmuxContent(content: string, style: TmuxBadgeStyle): string {
  if (style === "pill") return content;
  return `#[bold]${content}#[nobold]`;
}

export function buildTmuxBadgeBar(
  snapshot: StatuslineSnapshot,
  focusText?: string,
  style: TmuxBadgeStyle = "plain",
): string {
  const { agents, alerts } = buildStatusPills(snapshot);
  const renderBadge = (pill: StatusPill): string => {
    const content =
      style === "pill"
        ? tmuxPill(pill.label, pill.fg, pill.bg)
        : style === "minimal"
          ? tmuxTextAccent(pill.label, pill.bg)
          : pill.label;
    return pill.summaryTarget
      ? tmuxUserRange(serializeSummaryRange(pill.summaryTarget), content)
      : content;
  };
  const agentPills = agents.map((pill) => renderBadge(pill));
  const alertPills = alerts.map((pill) => renderBadge(pill));
  const focus =
    style === "pill"
      ? focusText
        ? `#[fg=#bac2de,bg=#181825] ${focusText} #[default]`
        : ""
      : (focusText ?? "");
  return [agentPills.join(" "), alertPills.join(" "), focus].filter(Boolean).join("  ");
}

export function buildTmuxAttentionPills(
  items: AttentionItem[],
  maxCount = 5,
  width?: number,
  style: TmuxBadgeStyle = "plain",
  options: {
    ordered?: boolean;
  } = {},
): string | undefined {
  if (maxCount <= 0) return undefined;
  const layout = resolveStatuslineDetailLayout(width, maxCount);
  const orderedItems = options.ordered ? items : orderedAttentionItems(items);
  const jumpItems = orderedItems
    .filter(
      (item): item is AttentionItem & { kind: Exclude<AttentionKind, "unmatched"> } =>
        item.kind !== "unmatched" && item.kind !== "stalled",
    )
    .slice(0, layout.itemCount);
  const pathLabels = buildStatuslinePathLabels(jumpItems, layout.pathMaxLength);

  if (jumpItems.length === 0) {
    return style === "pill"
      ? tmuxDetailBlock(STATUSLINE_EMPTY_FOCUS_LABEL)
      : style === "minimal"
        ? tmuxTextAccent(STATUSLINE_EMPTY_FOCUS_LABEL, "#bac2de")
        : STATUSLINE_EMPTY_FOCUS_LABEL;
  }

  const segments = jumpItems.map((item, index) => {
    const agent = agentShortName(item.agentName);
    const path = pathLabels[index];
    const time = formatElapsedCompact(item.lastActivityAt ?? item.lastResponseAt);
    const donePrefix = item.kind === "active" && item.phase === "done" ? "✓" : "";
    const label =
      item.kind === "permission"
        ? `⏳${agent} ${path} allow`
        : item.kind === "thinking"
          ? time
            ? `🤔${agent} ${path} ${time}`
            : `🤔${agent} ${path}`
          : item.kind === "tool"
            ? time
              ? `🔧${agent} ${path} ${time}`
              : `🔧${agent} ${path}`
            : item.kind === "active"
              ? time
                ? `${donePrefix}${agent} ${path} ${time}`
                : `${donePrefix}${agent} ${path}`
              : time
                ? `⚠${agent} ${path} ${time}`
                : `⚠${agent} ${path}`;
    const content =
      style === "pill"
        ? tmuxAttentionSegment(index + 1, item.kind, label)
        : style === "minimal"
          ? tmuxAttentionSegmentMinimal(index + 1, item.kind, label)
          : `${index + 1} ${label}`;
    return tmuxUserRange(`pid:${item.pid}`, content);
  });

  return segments.join("  ");
}

export function buildTmuxStatuslineAttentionPills(
  items: AttentionItem[],
  maxCount = 5,
  width?: number,
  style: TmuxBadgeStyle = "plain",
  options: StatuslineAttentionOptions = {},
): string | undefined {
  const jumpItems = buildStatuslineAttentionRepresentatives(items, maxCount, width, options);
  if (jumpItems.length === 0) {
    return style === "pill"
      ? tmuxDetailBlock(STATUSLINE_EMPTY_FOCUS_LABEL)
      : style === "minimal"
        ? tmuxTextAccent(STATUSLINE_EMPTY_FOCUS_LABEL, "#bac2de")
        : STATUSLINE_EMPTY_FOCUS_LABEL;
  }

  const segments = jumpItems.map((item, index) => {
    const label = formatStatuslineRepresentativeLabel(item);
    const baseContent =
      style === "pill"
        ? tmuxAttentionSegment(index + 1, item.kind, label)
        : style === "minimal"
          ? tmuxAttentionSegmentMinimal(index + 1, item.kind, label)
          : `${index + 1} ${label}`;
    const content = item.highlighted ? emphasizeTmuxContent(baseContent, style) : baseContent;
    return tmuxUserRange(`pid:${item.pid}`, content);
  });

  return segments.join("  ");
}

export function serializeWeztermPills(snapshot: StatuslineSnapshot, focusText?: string): string {
  const { agents, alerts } = buildStatusPills(snapshot);
  const lines = [
    ...agents.map((pill) => `agent\t${pill.label}\t${pill.fg}\t${pill.bg}`),
    ...alerts.map((pill) => `alert\t${pill.label}\t${pill.fg}\t${pill.bg}`),
  ];
  if (focusText) {
    for (const segment of focusText.split(" │ ")) {
      const trimmed = segment.trim();
      if (trimmed !== "") {
        lines.push(`focus\t${trimmed}\t#bac2de\t#181825`);
      }
    }
  }
  return lines.join("\n");
}
