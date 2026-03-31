import {
  type MarmonitorConfig,
  loadConfig,
  resolveConfigPath as resolveLoadedConfigPath,
} from "../config/index.js";

export type CollectorRuntime = {
  config: MarmonitorConfig;
  resolvedConfigPath?: string;
};

export async function loadCollectorRuntime(configPath?: string): Promise<CollectorRuntime> {
  const resolvedConfigPath = resolveLoadedConfigPath(configPath);
  const config = await loadConfig(resolvedConfigPath);
  return {
    config,
    resolvedConfigPath,
  };
}
