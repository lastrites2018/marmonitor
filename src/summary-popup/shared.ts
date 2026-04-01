export type SummaryPopupTarget =
  | "agent:claude"
  | "agent:codex"
  | "agent:gemini"
  | "phase:permission"
  | "phase:thinking"
  | "phase:tool"
  | "issue";

const VALID_SUMMARY_TARGETS = new Set<SummaryPopupTarget>([
  "agent:claude",
  "agent:codex",
  "agent:gemini",
  "phase:permission",
  "phase:thinking",
  "phase:tool",
  "issue",
]);

export function parseSummaryPopupTarget(value: string | undefined): SummaryPopupTarget | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  return VALID_SUMMARY_TARGETS.has(normalized as SummaryPopupTarget)
    ? (normalized as SummaryPopupTarget)
    : undefined;
}

export function parseSummaryRange(value: string | undefined): SummaryPopupTarget | undefined {
  if (!value) return undefined;
  const match = /^summary:(.+)$/.exec(value.trim());
  return parseSummaryPopupTarget(match?.[1]);
}

export function serializeSummaryRange(target: SummaryPopupTarget): string {
  return `summary:${target}`;
}
