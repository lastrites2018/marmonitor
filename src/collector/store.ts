import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { profileAsync } from "../perf.js";
import {
  readCacheFile,
  snapshotCacheFile,
  statuslineCacheFile,
  writeCacheFileAtomically,
} from "../snapshot-cache.js";
import type { AgentSession } from "../types.js";
import type { CachedArtifact, CollectorHealth } from "./model.js";

const COLLECTOR_LOCK_STALE_MS = 30_000;

function collectorDir(root = tmpdir()): string {
  return join(root, "marmonitor", "collector");
}

export function collectorHealthFile(root = tmpdir()): string {
  return join(collectorDir(root), "health.json");
}

export function collectorSnapshotFile(root = tmpdir()): string {
  return join(collectorDir(root), "snapshot-light.json");
}

export function collectorStatuslineFile(
  format: string,
  attentionLimit: number,
  width?: number,
  root = tmpdir(),
): string {
  const widthKey = width && width > 0 ? String(width) : "auto";
  return join(collectorDir(root), `statusline-${format}-${attentionLimit}-${widthKey}.txt`);
}

export function collectorRunLockFile(root = tmpdir()): string {
  return join(collectorDir(root), "collector.lock");
}

export async function readCachedStatusline(
  format: string,
  attentionLimit: number,
  width: number | undefined,
  ttlMs: number,
): Promise<string | undefined> {
  const cached = await readCachedStatuslineEntry(format, attentionLimit, width, ttlMs);
  return cached?.fresh ? cached.value : undefined;
}

export async function readCachedStatuslineEntry(
  format: string,
  attentionLimit: number,
  width: number | undefined,
  ttlMs: number,
): Promise<CachedArtifact<string> | undefined> {
  return await profileAsync("cli", "readCachedStatusline", async () => {
    const path = statuslineCacheFile(format, attentionLimit, width);
    const cached = await readCacheFile(path, ttlMs, (raw) => raw.trimEnd());
    if (!cached) return undefined;
    return {
      value: cached.value,
      ageMs: cached.ageMs,
      fresh: cached.fresh,
    };
  });
}

export async function writeCachedStatusline(
  format: string,
  attentionLimit: number,
  width: number | undefined,
  value: string,
): Promise<void> {
  await profileAsync("cli", "writeCachedStatusline", async () => {
    const path = statuslineCacheFile(format, attentionLimit, width);
    try {
      await mkdir(join(tmpdir(), "marmonitor"), { recursive: true });
      await writeCacheFileAtomically(path, value);
    } catch {
      // cache failures must never break statusline rendering
    }
  });
}

export async function readCachedSnapshot(
  enrichmentMode: "full" | "light",
  showDead: boolean,
  ttlMs: number,
): Promise<AgentSession[] | undefined> {
  const cached = await readCachedSnapshotEntry(enrichmentMode, showDead, ttlMs);
  return cached?.fresh ? cached.value : undefined;
}

export async function readCachedSnapshotEntry(
  enrichmentMode: "full" | "light",
  showDead: boolean,
  ttlMs: number,
): Promise<CachedArtifact<AgentSession[]> | undefined> {
  return await profileAsync("snapshot", "readCachedSnapshot", async () => {
    const path = snapshotCacheFile(enrichmentMode, showDead);
    const cached = await readCacheFile(path, ttlMs, (raw) => JSON.parse(raw) as AgentSession[]);
    if (!cached) return undefined;
    return {
      value: cached.value,
      ageMs: cached.ageMs,
      fresh: cached.fresh,
    };
  });
}

export async function writeCachedSnapshot(
  enrichmentMode: "full" | "light",
  showDead: boolean,
  agents: AgentSession[],
): Promise<void> {
  await profileAsync("snapshot", "writeCachedSnapshot", async () => {
    const path = snapshotCacheFile(enrichmentMode, showDead);
    try {
      await mkdir(join(tmpdir(), "marmonitor"), { recursive: true });
      await writeCacheFileAtomically(path, JSON.stringify(agents));
    } catch {
      // snapshot cache failures must never break command execution
    }
  });
}

export async function readCollectorHealth(
  ttlMs: number,
  root = tmpdir(),
): Promise<CachedArtifact<CollectorHealth> | undefined> {
  return await profileAsync("collector", "readHealth", async () => {
    const cached = await readCacheFile(
      collectorHealthFile(root),
      ttlMs,
      (raw) => JSON.parse(raw) as CollectorHealth,
    );
    if (!cached) return undefined;
    return {
      value: cached.value,
      ageMs: cached.ageMs,
      fresh: cached.fresh,
    };
  });
}

export async function writeCollectorHealth(
  health: CollectorHealth,
  root = tmpdir(),
): Promise<void> {
  await profileAsync("collector", "writeHealth", async () => {
    await mkdir(dirname(collectorHealthFile(root)), { recursive: true });
    await writeCacheFileAtomically(collectorHealthFile(root), JSON.stringify(health));
  });
}

export async function clearCollectorHealth(root = tmpdir()): Promise<void> {
  try {
    await unlink(collectorHealthFile(root));
  } catch {
    // collector health cleanup must never break command execution
  }
}

export async function readCollectorSnapshot(
  ttlMs: number,
  root = tmpdir(),
): Promise<CachedArtifact<AgentSession[]> | undefined> {
  return await profileAsync("collector", "readSnapshot", async () => {
    const cached = await readCacheFile(
      collectorSnapshotFile(root),
      ttlMs,
      (raw) => JSON.parse(raw) as AgentSession[],
    );
    if (!cached) return undefined;
    return {
      value: cached.value,
      ageMs: cached.ageMs,
      fresh: cached.fresh,
    };
  });
}

export async function writeCollectorSnapshot(
  agents: AgentSession[],
  root = tmpdir(),
): Promise<void> {
  await profileAsync("collector", "writeSnapshot", async () => {
    await mkdir(dirname(collectorSnapshotFile(root)), { recursive: true });
    await writeCacheFileAtomically(collectorSnapshotFile(root), JSON.stringify(agents));
  });
}

export async function readCollectorStatusline(
  format: string,
  attentionLimit: number,
  width: number | undefined,
  ttlMs: number,
  root = tmpdir(),
): Promise<CachedArtifact<string> | undefined> {
  return await profileAsync("collector", "readStatusline", async () => {
    const cached = await readCacheFile(
      collectorStatuslineFile(format, attentionLimit, width, root),
      ttlMs,
      (raw) => raw.trimEnd(),
    );
    if (!cached) return undefined;
    return {
      value: cached.value,
      ageMs: cached.ageMs,
      fresh: cached.fresh,
    };
  });
}

export async function writeCollectorStatusline(
  format: string,
  attentionLimit: number,
  width: number | undefined,
  value: string,
  root = tmpdir(),
): Promise<void> {
  await profileAsync("collector", "writeStatusline", async () => {
    await mkdir(dirname(collectorStatuslineFile(format, attentionLimit, width, root)), {
      recursive: true,
    });
    await writeCacheFileAtomically(
      collectorStatuslineFile(format, attentionLimit, width, root),
      value,
    );
  });
}

export async function acquireCollectorRunLock(root = tmpdir()): Promise<boolean> {
  const path = collectorRunLockFile(root);
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch {
    return false;
  }

  try {
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error)) return false;
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;

    try {
      const lockStat = await stat(path);
      if (Date.now() - lockStat.mtimeMs < COLLECTOR_LOCK_STALE_MS) {
        return false;
      }
    } catch {
      return false;
    }

    try {
      await unlink(path);
    } catch {
      return false;
    }

    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, createdAt: Date.now(), recovered: true }),
        );
      } finally {
        await handle.close();
      }
      return true;
    } catch {
      return false;
    }
  }
}

export async function releaseCollectorRunLock(root = tmpdir()): Promise<void> {
  try {
    await unlink(collectorRunLockFile(root));
  } catch {
    // collector lock cleanup must never break command execution
  }
}
