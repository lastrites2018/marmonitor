export type SummaryPopupTarget =
  | "agent:claude"
  | "agent:codex"
  | "agent:gemini"
  | "idle"
  | "phase:permission"
  | "phase:thinking"
  | "phase:tool"
  | "issue";

const VALID_SUMMARY_TARGETS = new Set<SummaryPopupTarget>([
  "agent:claude",
  "agent:codex",
  "agent:gemini",
  "idle",
  "phase:permission",
  "phase:thinking",
  "phase:tool",
  "issue",
]);

const RANGE_TO_TARGET: Record<string, SummaryPopupTarget> = {
  "sum:claude": "agent:claude",
  "sum:codex": "agent:codex",
  "sum:gemini": "agent:gemini",
  "sum:idle": "idle",
  "sum:perm": "phase:permission",
  "sum:think": "phase:thinking",
  "sum:tool": "phase:tool",
  "sum:issue": "issue",
};

const TARGET_TO_RANGE = new Map<SummaryPopupTarget, string>(
  Object.entries(RANGE_TO_TARGET).map(([range, target]) => [target, range]),
);

export function parseSummaryPopupTarget(value: string | undefined): SummaryPopupTarget | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  return VALID_SUMMARY_TARGETS.has(normalized as SummaryPopupTarget)
    ? (normalized as SummaryPopupTarget)
    : undefined;
}

export function parseSummaryRange(value: string | undefined): SummaryPopupTarget | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (normalized in RANGE_TO_TARGET) {
    return RANGE_TO_TARGET[normalized];
  }
  const legacyMatch = /^summary:(.+)$/.exec(normalized);
  return parseSummaryPopupTarget(legacyMatch?.[1]);
}

export function serializeSummaryRange(target: SummaryPopupTarget): string {
  return TARGET_TO_RANGE.get(target) ?? `summary:${target}`;
}
