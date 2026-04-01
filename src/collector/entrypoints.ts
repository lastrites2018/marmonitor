import { basename } from "node:path";
import { fileURLToPath } from "node:url";

function looksLikeStatuslineEntrypoint(entrypoint: string | undefined): boolean {
  if (!entrypoint) return false;
  return basename(entrypoint).includes("statusline");
}

function looksLikeCliEntrypoint(entrypoint: string | undefined): boolean {
  if (!entrypoint) return false;
  return basename(entrypoint) === "marmonitor.js";
}

const DEFAULT_CLI_ENTRYPOINT = fileURLToPath(new URL("../../bin/marmonitor.js", import.meta.url));
const DEFAULT_STATUSLINE_ENTRYPOINT = fileURLToPath(
  new URL("../../bin/marmonitor-statusline.js", import.meta.url),
);

export function resolveCliEntrypoint(): string {
  if (process.env.MARMONITOR_CLI_ENTRYPOINT) {
    return process.env.MARMONITOR_CLI_ENTRYPOINT;
  }
  if (looksLikeCliEntrypoint(process.argv[1])) {
    return process.argv[1];
  }
  return DEFAULT_CLI_ENTRYPOINT;
}

export function resolveStatuslineEntrypoint(): string {
  if (process.env.MARMONITOR_STATUSLINE_ENTRYPOINT) {
    return process.env.MARMONITOR_STATUSLINE_ENTRYPOINT;
  }
  if (looksLikeStatuslineEntrypoint(process.argv[1])) {
    return process.argv[1];
  }
  return DEFAULT_STATUSLINE_ENTRYPOINT;
}

export function shouldUseThinStatuslineClient(args: string[]): boolean {
  return args.includes("--statusline");
}
