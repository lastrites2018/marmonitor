/**
 * Public types for the scanner module.
 */

import type { AgentSession } from "../types.js";

export interface ScanOptions {
  enrichmentMode?: "full" | "light";
  includeTokenUsage?: boolean;
  includeStdoutHeuristic?: boolean;
  useSharedRuntimeSnapshots?: boolean;
  seedSessions?: AgentSession[];
  seedTransitionSessions?: AgentSession[];
}
