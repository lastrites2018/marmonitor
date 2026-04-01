import type { StatuslineFormat } from "./utils.js";

export function renderUnavailableStatusline(format: StatuslineFormat = "compact"): string {
  if (format === "wezterm-pills") {
    return "focus\tmarmonitor unavailable\t#bac2de\t#313244";
  }
  return "marmonitor unavailable";
}
