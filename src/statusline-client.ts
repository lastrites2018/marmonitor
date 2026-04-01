import { runStatuslineCommand } from "./collector/statusline.js";
import { renderUnavailableStatusline } from "./output/index.js";
import type { StatuslineFormat } from "./output/utils.js";
import { findJumpAnchorByClientTty } from "./tmux/jump-anchor.js";

const VALID_FORMATS = new Set<StatuslineFormat>([
  "compact",
  "standard",
  "extended",
  "tmux-badges",
  "wezterm-pills",
]);

export type StatuslineClientOptions = {
  format: StatuslineFormat;
  width?: number;
  configPath?: string;
  clientTty?: string;
};

const TMUX_DETAIL_MARKER = "  #[range=user|pid:";
const TMUX_BACK_RANGE = "#[range=user|back]↩#[norange]";

export function appendJumpBackIndicator(output: string, hasAnchor: boolean): string {
  if (!hasAnchor) return output;
  const detailIndex = output.indexOf(TMUX_DETAIL_MARKER);
  if (detailIndex === -1) {
    return `${output}  ${TMUX_BACK_RANGE}`;
  }
  const summary = output.slice(0, detailIndex);
  const detail = output.slice(detailIndex);
  return `${summary}  ${TMUX_BACK_RANGE}${detail}`;
}

export function parseStatuslineClientArgs(args: string[]): StatuslineClientOptions {
  let format: StatuslineFormat = "compact";
  let width: number | undefined;
  let configPath: string | undefined;
  let clientTty: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--statusline") continue;
    if (arg === "--statusline-format") {
      const value = args[index + 1];
      if (value && VALID_FORMATS.has(value as StatuslineFormat)) {
        format = value as StatuslineFormat;
        index += 1;
      }
      continue;
    }
    if (arg === "--width") {
      const value = Number.parseInt(args[index + 1] ?? "", 10);
      if (Number.isFinite(value) && value > 0) {
        width = value;
        index += 1;
      }
      continue;
    }
    if (arg === "--config") {
      const value = args[index + 1];
      if (value) {
        configPath = value;
        index += 1;
      }
      continue;
    }
    if (arg === "--client-tty" || arg === "--target-client") {
      const value = args[index + 1];
      if (value) {
        clientTty = value;
        index += 1;
      }
    }
  }

  return {
    format,
    width,
    configPath,
    clientTty,
  };
}

export async function runStatuslineClient(args: string[] = process.argv.slice(2)): Promise<string> {
  const options = parseStatuslineClientArgs(args);
  try {
    const output = await runStatuslineCommand(options);
    if (options.format !== "tmux-badges" || !options.clientTty) {
      return output;
    }
    const hasAnchor = Boolean(await findJumpAnchorByClientTty(options.clientTty));
    return appendJumpBackIndicator(output, hasAnchor);
  } catch {
    return renderUnavailableStatusline(options.format);
  }
}

export async function main(): Promise<void> {
  const output = await runStatuslineClient();
  console.log(output);
}
