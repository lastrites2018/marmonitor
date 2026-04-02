import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCacheFileAtomically } from "../snapshot-cache.js";

export const JUMP_ANCHOR_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface TmuxJumpAnchor {
  clientId: string;
  clientTty?: string;
  originSessionId: string;
  originWindowId: string;
  originPaneId: string;
  originCwd?: string;
  recordedAt: number;
  lastJumpedAt?: number;
}

function jumpAnchorDir(root = tmpdir()): string {
  return join(root, "marmonitor", "jump-anchors");
}

function encodeAnchorKey(clientId: string): string {
  return encodeURIComponent(clientId);
}

function decodeAnchorKey(value: string): string {
  return decodeURIComponent(value);
}

export function jumpAnchorFile(clientId: string, root = tmpdir()): string {
  return join(jumpAnchorDir(root), `${encodeAnchorKey(clientId)}.json`);
}

export async function readJumpAnchor(
  clientId: string,
  root = tmpdir(),
): Promise<TmuxJumpAnchor | undefined> {
  try {
    const raw = await readFile(jumpAnchorFile(clientId, root), "utf8");
    return JSON.parse(raw) as TmuxJumpAnchor;
  } catch {
    return undefined;
  }
}

export async function findJumpAnchorByClientTty(
  clientTty: string,
  root = tmpdir(),
): Promise<TmuxJumpAnchor | undefined> {
  const direct = await readJumpAnchor(clientTty, root);
  if (direct) {
    return direct;
  }

  const clientIds = await listJumpAnchorClientIds(root);
  for (const clientId of clientIds) {
    const anchor = await readJumpAnchor(clientId, root);
    if (anchor?.clientTty === clientTty) {
      return anchor;
    }
  }

  return undefined;
}

export async function writeJumpAnchor(anchor: TmuxJumpAnchor, root = tmpdir()): Promise<void> {
  await mkdir(jumpAnchorDir(root), { recursive: true });
  await writeCacheFileAtomically(jumpAnchorFile(anchor.clientId, root), JSON.stringify(anchor));
}

export async function clearJumpAnchor(clientId: string, root = tmpdir()): Promise<void> {
  try {
    await rm(jumpAnchorFile(clientId, root), { force: true });
  } catch {
    // jump anchor cleanup must never break command execution
  }
}

export async function listJumpAnchorClientIds(root = tmpdir()): Promise<string[]> {
  try {
    const entries = await readdir(jumpAnchorDir(root), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => decodeAnchorKey(entry.name.replace(/\.json$/, "")));
  } catch {
    return [];
  }
}

export async function pruneJumpAnchors(
  params: {
    activeClientIds?: Iterable<string>;
    maxAgeMs?: number;
    now?: number;
    root?: string;
  } = {},
): Promise<void> {
  const now = params.now ?? Date.now();
  const maxAgeMs = params.maxAgeMs ?? JUMP_ANCHOR_MAX_AGE_MS;
  const activeClientIds = params.activeClientIds ? new Set(params.activeClientIds) : undefined;
  const root = params.root ?? tmpdir();
  const clientIds = await listJumpAnchorClientIds(root);

  await Promise.all(
    clientIds.map(async (clientId) => {
      const anchor = await readJumpAnchor(clientId, root);
      if (!anchor) {
        await clearJumpAnchor(clientId, root);
        return;
      }

      if (activeClientIds && !activeClientIds.has(clientId)) {
        await clearJumpAnchor(clientId, root);
        return;
      }

      const lastTouchedAt = anchor.lastJumpedAt ?? anchor.recordedAt;
      if (now - lastTouchedAt > maxAgeMs) {
        await clearJumpAnchor(clientId, root);
      }
    }),
  );
}
