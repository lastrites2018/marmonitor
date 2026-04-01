import type { AgentSession, SessionPhase } from "../types.js";

function isRecentWorkPhase(phase: SessionPhase): phase is "thinking" | "tool" {
  return phase === "thinking" || phase === "tool";
}

function sessionReferenceAt(
  session: Pick<AgentSession, "lastActivityAt" | "lastResponseAt" | "startedAt">,
): number | undefined {
  return session.lastActivityAt ?? session.lastResponseAt ?? session.startedAt;
}

export function deriveSessionTransitionState(
  current: Pick<
    AgentSession,
    "status" | "phase" | "lastActivityAt" | "lastResponseAt" | "startedAt"
  >,
  previous?: Pick<AgentSession, "status" | "phase" | "idleSince" | "recentCompleteAt">,
  nowSec = Date.now() / 1000,
): Pick<AgentSession, "idleSince" | "recentCompleteAt"> {
  if (current.status !== "Idle") {
    return {
      idleSince: undefined,
      recentCompleteAt: undefined,
    };
  }

  const referenceAt = sessionReferenceAt(current) ?? nowSec;

  if (!previous || previous.status !== "Idle") {
    return {
      idleSince: referenceAt,
      recentCompleteAt:
        previous?.status === "Active" && isRecentWorkPhase(previous.phase)
          ? referenceAt
          : undefined,
    };
  }

  return {
    idleSince: previous.idleSince ?? referenceAt,
    recentCompleteAt: previous.recentCompleteAt,
  };
}
