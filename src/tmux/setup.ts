/**
 * tmux.conf plugin line management.
 * Adds/removes the marmonitor-tmux tpm plugin line.
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PLUGIN_LINE = "set -g @plugin 'mjjo16/marmonitor-tmux'";
const DEFAULT_PLUGIN_RELATIVE_PATH = ".tmux/plugins/marmonitor-tmux";
const DEFAULT_PLUGIN_SCRIPT_SUFFIX = `${DEFAULT_PLUGIN_RELATIVE_PATH}/marmonitor.tmux`;

export type TmuxIntegrationMode = "local" | "missing" | "tpm" | "not_git" | "unconfigured";

export interface TmuxIntegrationStatus {
  mode: TmuxIntegrationMode;
  confPath: string;
  pluginDir: string;
  pluginConfigured: boolean;
  pluginDirExists: boolean;
  pluginIsGitCheckout: boolean;
  localRunShellPath?: string;
  pluginRunShellPath?: string;
}

function matchesPluginLine(line: string): boolean {
  return line.trim() === PLUGIN_LINE;
}

function normalizePathForTmuxMatch(value: string): string {
  return value.replace(/^~\//, "").replace(/\\/g, "/");
}

function extractRunShellPath(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.includes("run-shell") || !trimmed.includes("marmonitor.tmux")) return undefined;
  const match =
    /run-shell\s+(?:"([^"]*marmonitor\.tmux)"|'([^']*marmonitor\.tmux)'|([^"' ]*marmonitor\.tmux))/.exec(
      trimmed,
    );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function classifyRunShellPath(path: string | undefined): "local" | "plugin" | undefined {
  if (!path) return undefined;
  const normalized = normalizePathForTmuxMatch(path);
  if (normalized.endsWith(DEFAULT_PLUGIN_SCRIPT_SUFFIX)) return "plugin";
  return "local";
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function getDefaultTmuxConfPath(homePath = homedir()): string {
  return join(homePath, ".tmux.conf");
}

export function getDefaultTmuxPluginDir(homePath = homedir()): string {
  return join(homePath, DEFAULT_PLUGIN_RELATIVE_PATH);
}

export async function hasMarmonitorPlugin(confPath: string): Promise<boolean> {
  try {
    const content = await readFile(confPath, "utf-8");
    return content.split("\n").some(matchesPluginLine);
  } catch {
    return false;
  }
}

export async function addMarmonitorPlugin(confPath: string): Promise<boolean> {
  if (await hasMarmonitorPlugin(confPath)) return false;

  let existing = "";
  try {
    existing = await readFile(confPath, "utf-8");
  } catch {
    // file doesn't exist yet — will create
  }

  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(confPath, `${existing}${separator}${PLUGIN_LINE}\n`, "utf-8");
  return true;
}

export async function removeMarmonitorPlugin(confPath: string): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(confPath, "utf-8");
  } catch {
    return false;
  }

  const lines = content.split("\n");
  const filtered = lines.filter((line) => !matchesPluginLine(line));

  if (filtered.length === lines.length) return false;

  await writeFile(confPath, filtered.join("\n"), "utf-8");
  return true;
}

export async function detectTmuxIntegrationStatus(params: {
  confPath: string;
  pluginDir: string;
}): Promise<TmuxIntegrationStatus> {
  let content = "";
  try {
    content = await readFile(params.confPath, "utf-8");
  } catch {
    // best effort diagnostic; missing conf means unconfigured unless plugin dir is explicitly wired elsewhere
  }

  const lines = content.split("\n");
  const pluginConfigured = lines.some(matchesPluginLine);
  const runShellPaths = lines
    .map(extractRunShellPath)
    .filter((value): value is string => Boolean(value));
  const localRunShellPath = runShellPaths.find((path) => classifyRunShellPath(path) === "local");
  const pluginRunShellPath = runShellPaths.find((path) => classifyRunShellPath(path) === "plugin");
  const pluginDirExists = await directoryExists(params.pluginDir);
  const pluginIsGitCheckout = pluginDirExists
    ? await pathExists(join(params.pluginDir, ".git"))
    : false;

  if (localRunShellPath) {
    return {
      mode: "local",
      confPath: params.confPath,
      pluginDir: params.pluginDir,
      pluginConfigured,
      pluginDirExists,
      pluginIsGitCheckout,
      localRunShellPath,
      pluginRunShellPath,
    };
  }

  if (pluginConfigured || pluginRunShellPath) {
    if (!pluginDirExists) {
      return {
        mode: "missing",
        confPath: params.confPath,
        pluginDir: params.pluginDir,
        pluginConfigured,
        pluginDirExists,
        pluginIsGitCheckout,
        pluginRunShellPath,
      };
    }

    return {
      mode: pluginIsGitCheckout ? "tpm" : "not_git",
      confPath: params.confPath,
      pluginDir: params.pluginDir,
      pluginConfigured,
      pluginDirExists,
      pluginIsGitCheckout,
      pluginRunShellPath,
    };
  }

  return {
    mode: "unconfigured",
    confPath: params.confPath,
    pluginDir: params.pluginDir,
    pluginConfigured,
    pluginDirExists,
    pluginIsGitCheckout,
  };
}
