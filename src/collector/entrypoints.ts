import { basename } from "node:path";

function looksLikeStatuslineEntrypoint(entrypoint: string | undefined): boolean {
  if (!entrypoint) return false;
  return basename(entrypoint).includes("statusline");
}

function looksLikeCliEntrypoint(entrypoint: string | undefined): boolean {
  if (!entrypoint) return false;
  return basename(entrypoint) === "marmonitor.js";
}

export function resolveCliEntrypoint(): string {
  if (process.env.MARMONITOR_CLI_ENTRYPOINT) {
    return process.env.MARMONITOR_CLI_ENTRYPOINT;
  }
  if (looksLikeCliEntrypoint(process.argv[1])) {
    return process.argv[1];
  }
  return "bin/marmonitor.js";
}

export function resolveStatuslineEntrypoint(): string {
  if (process.env.MARMONITOR_STATUSLINE_ENTRYPOINT) {
    return process.env.MARMONITOR_STATUSLINE_ENTRYPOINT;
  }
  if (looksLikeStatuslineEntrypoint(process.argv[1])) {
    return process.argv[1];
  }
  return "bin/marmonitor-statusline.js";
}

export function shouldUseThinStatuslineClient(args: string[]): boolean {
  return args.includes("--statusline");
}
