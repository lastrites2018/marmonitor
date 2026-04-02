import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compactStatuslineDirLabel,
  formatElapsedCompact,
  visibleTextWidth,
} from "../output/utils.js";
import { writeCacheFileAtomically } from "../snapshot-cache.js";
import type { AgentSession, SessionPhase } from "../types.js";

export const JUMP_BRIEFING_TTL_MS = 5_000;
const MAX_JUMP_BRIEFING_WIDTH = 32;

export type TmuxJumpBriefingReason = "keyboard" | "popup";

export interface TmuxJumpBriefing {
  clientId: string;
  clientTty?: string;
  text: string;
  reason: TmuxJumpBriefingReason;
  createdAt: number;
  expiresAt: number;
}

type JumpBriefingAgent = Pick<AgentSession, "cwd"> &
  Partial<
    Pick<AgentSession, "agentName" | "phase" | "lastActivityAt" | "lastResponseAt" | "startedAt">
  >;

function jumpBriefingDir(root = tmpdir()): string {
  return join(root, "marmonitor", "jump-briefings");
}

function encodeBriefingKey(clientId: string): string {
  return encodeURIComponent(clientId);
}

function decodeBriefingKey(value: string): string {
  return decodeURIComponent(value);
}

export function jumpBriefingFile(clientId: string, root = tmpdir()): string {
  return join(jumpBriefingDir(root), `${encodeBriefingKey(clientId)}.json`);
}

function phaseIcon(phase?: SessionPhase): string | undefined {
  switch (phase) {
    case "thinking":
      return "🤔";
    case "tool":
      return "🔧";
    case "permission":
      return "⏳";
    case "done":
      return "✅";
    default:
      return undefined;
  }
}

function shortAgentLabel(agentName?: string): string {
  switch (agentName) {
    case "Claude Code":
      return "Cl";
    case "Codex":
      return "Cx";
    case "Gemini":
      return "Gm";
    default:
      return "AI";
  }
}

function truncateToVisibleWidth(text: string, maxWidth: number): string {
  if (visibleTextWidth(text) <= maxWidth) {
    return text;
  }
  if (maxWidth <= 1) {
    return "…".slice(0, maxWidth);
  }

  let result = "";
  for (const char of text) {
    const next = `${result}${char}`;
    if (visibleTextWidth(`${next}…`) > maxWidth) {
      break;
    }
    result = next;
  }
  return `${result}…`;
}

export function buildJumpBriefingText(
  agent: JumpBriefingAgent,
  nowSec = Date.now() / 1000,
): string {
  const parts = [
    `↪ ${shortAgentLabel(agent.agentName)} ${compactStatuslineDirLabel(agent.cwd, 18)}`,
  ];
  const icon = phaseIcon(agent.phase);
  if (icon) {
    parts.push(icon);
  }
  const elapsed = formatElapsedCompact(
    agent.lastActivityAt ?? agent.lastResponseAt ?? agent.startedAt,
    nowSec,
  );
  if (elapsed) {
    parts.push(elapsed);
  }
  const text = parts.join(" · ");
  return truncateToVisibleWidth(text, MAX_JUMP_BRIEFING_WIDTH);
}

async function readAndValidateJumpBriefing(
  clientId: string,
  root = tmpdir(),
  now = Date.now(),
): Promise<TmuxJumpBriefing | undefined> {
  try {
    const raw = await readFile(jumpBriefingFile(clientId, root), "utf8");
    const briefing = JSON.parse(raw) as TmuxJumpBriefing;
    if (briefing.expiresAt <= now) {
      await clearJumpBriefing(clientId, root);
      return undefined;
    }
    return briefing;
  } catch {
    return undefined;
  }
}

export async function readJumpBriefing(
  clientId: string,
  root = tmpdir(),
  now = Date.now(),
): Promise<TmuxJumpBriefing | undefined> {
  return readAndValidateJumpBriefing(clientId, root, now);
}

export async function findJumpBriefingByClientTty(
  clientTty: string,
  root = tmpdir(),
  now = Date.now(),
): Promise<TmuxJumpBriefing | undefined> {
  const direct = await readAndValidateJumpBriefing(clientTty, root, now);
  if (direct) {
    return direct;
  }

  const clientIds = await listJumpBriefingClientIds(root);
  for (const clientId of clientIds) {
    const briefing = await readAndValidateJumpBriefing(clientId, root, now);
    if (briefing?.clientTty === clientTty) {
      return briefing;
    }
  }

  return undefined;
}

export async function writeJumpBriefing(
  briefing: TmuxJumpBriefing,
  root = tmpdir(),
): Promise<void> {
  await mkdir(jumpBriefingDir(root), { recursive: true });
  await writeCacheFileAtomically(
    jumpBriefingFile(briefing.clientId, root),
    JSON.stringify(briefing),
  );
}

export async function clearJumpBriefing(clientId: string, root = tmpdir()): Promise<void> {
  try {
    await rm(jumpBriefingFile(clientId, root), { force: true });
  } catch {
    // jump briefing cleanup must never break command execution
  }
}

export async function listJumpBriefingClientIds(root = tmpdir()): Promise<string[]> {
  try {
    const entries = await readdir(jumpBriefingDir(root), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => decodeBriefingKey(entry.name.replace(/\.json$/, "")));
  } catch {
    return [];
  }
}
