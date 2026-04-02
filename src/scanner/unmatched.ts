import type { UnmatchedReason } from "../types.js";

export const UNMATCHED_STARTUP_GRACE_SEC = 120;

export interface UnmatchedReasonContext {
  cwd?: string;
  startedAt?: number;
  nowSec?: number;
  sessionLookupAttempted?: boolean;
  ambiguousMatch?: boolean;
}

export function deriveUnmatchedReason(
  context: UnmatchedReasonContext,
): UnmatchedReason | undefined {
  if (context.ambiguousMatch) return "ambiguous_match";
  if (!context.cwd || context.cwd === "unknown") return "cwd_unknown";

  const nowSec = context.nowSec ?? Date.now() / 1000;
  if (
    context.startedAt !== undefined &&
    Number.isFinite(context.startedAt) &&
    nowSec - context.startedAt < UNMATCHED_STARTUP_GRACE_SEC
  ) {
    return "startup_grace";
  }

  if (context.sessionLookupAttempted) return "session_file_missing";
  return "unknown";
}
