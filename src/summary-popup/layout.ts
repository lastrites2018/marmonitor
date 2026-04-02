import type { SummaryPopupTarget } from "./shared.js";

export interface SummaryPopupSize {
  width: number;
  height: number;
}

export type SummaryPopupControlsMode = "full" | "compact" | "minimal";

export interface SummaryPopupRenderLayout {
  pageSize: number;
  controlsMode: SummaryPopupControlsMode;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function boundedSize(
  preferred: number,
  minPreferred: number,
  maxPreferred: number,
  maxBound: number,
): number {
  if (maxBound <= 0) return maxPreferred;
  if (maxBound < minPreferred) return maxBound;
  return clamp(preferred, minPreferred, Math.min(maxPreferred, maxBound));
}

export function resolveSummaryPopupSize(
  clientWidth?: number,
  clientHeight?: number,
): SummaryPopupSize | undefined {
  if (!clientWidth || !clientHeight || clientWidth <= 0 || clientHeight <= 0) return undefined;

  const width = boundedSize(Math.floor(clientWidth * 0.72), 60, 140, Math.max(30, clientWidth - 4));
  const height = boundedSize(
    Math.floor(clientHeight * 0.7),
    14,
    40,
    Math.max(10, clientHeight - 2),
  );

  return { width, height };
}

export function resolveSummaryPopupRenderLayout(
  target: SummaryPopupTarget,
  rows?: number,
): SummaryPopupRenderLayout {
  if (!rows || rows <= 0) {
    return { pageSize: 7, controlsMode: "full" };
  }

  const reservedLines = target === "issue" ? 8 : 5;
  const linesPerItem = 3;
  const pageSize = clamp(Math.floor((rows - reservedLines) / linesPerItem), 1, 10);

  if (rows >= 22) {
    return { pageSize, controlsMode: "full" };
  }
  if (rows >= 18) {
    return { pageSize, controlsMode: "compact" };
  }
  return { pageSize, controlsMode: "minimal" };
}
