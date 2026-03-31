import { spawnSync } from "node:child_process";
import { resolveCliEntrypoint } from "./collector/entrypoints.js";

export function extractPidFromStatusRange(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^pid:(\d+)$/.exec(value.trim());
  return match?.[1];
}

export function parseStatusClickArgs(args: string[]): {
  pid?: string;
  configPath?: string;
} {
  const directRange = args[0];
  let configPath: string | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--config") {
      const value = args[index + 1];
      if (value) {
        configPath = value;
        index += 1;
      }
    }
  }

  return {
    pid: extractPidFromStatusRange(directRange),
    configPath,
  };
}

export function runStatusClick(args: string[] = process.argv.slice(2)): number {
  const options = parseStatusClickArgs(args);
  if (!options.pid) return 0;

  const cliArgs = [
    resolveCliEntrypoint(),
    "jump",
    "--pid",
    options.pid,
    ...(options.configPath ? ["--config", options.configPath] : []),
  ];
  const result = spawnSync(process.execPath, cliArgs, {
    stdio: "ignore",
    env: process.env,
  });
  return result.status ?? 0;
}

export function main(): void {
  process.exit(runStatusClick());
}
