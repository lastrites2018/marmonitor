import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const SNAPSHOT_LOCK_STALE_MS = 15_000;
export const STATUSLINE_REFRESH_LOCK_STALE_MS = 30_000;

export interface CacheReadResult<T> {
  value: T;
  ageMs: number;
  fresh: boolean;
  mtimeMs: number;
}

function cacheDir(root = tmpdir()): string {
  return join(root, "marmonitor");
}

export function statuslineCacheFile(
  format: string,
  attentionLimit: number,
  width?: number,
  root = tmpdir(),
): string {
  const widthKey = width && width > 0 ? String(width) : "auto";
  return join(cacheDir(root), `statusline-${format}-${attentionLimit}-${widthKey}.txt`);
}

export function snapshotCacheFile(
  enrichmentMode: "full" | "light",
  showDead: boolean,
  root = tmpdir(),
): string {
  return join(cacheDir(root), `snapshot-${enrichmentMode}-${showDead ? "dead" : "alive"}.json`);
}

export function snapshotRefreshLockFile(
  enrichmentMode: "full" | "light",
  showDead: boolean,
  root = tmpdir(),
): string {
  return join(cacheDir(root), `snapshot-${enrichmentMode}-${showDead ? "dead" : "alive"}.lock`);
}

export function statuslineRefreshLockFile(
  format: string,
  attentionLimit: number,
  width?: number,
  root = tmpdir(),
): string {
  const widthKey = width && width > 0 ? String(width) : "auto";
  return join(cacheDir(root), `statusline-${format}-${attentionLimit}-${widthKey}.lock`);
}

export async function readCacheFile<T>(
  path: string,
  ttlMs: number,
  parse: (raw: string) => T,
): Promise<CacheReadResult<T> | undefined> {
  try {
    const fileStat = await stat(path);
    const ageMs = Date.now() - fileStat.mtimeMs;
    const raw = await readFile(path, "utf-8");
    return {
      value: parse(raw),
      ageMs,
      fresh: ageMs <= ttlMs,
      mtimeMs: fileStat.mtimeMs,
    };
  } catch {
    return undefined;
  }
}

export async function writeCacheFileAtomically(path: string, value: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tempPath, value, "utf-8");
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function releaseSnapshotRefreshLock(
  enrichmentMode: "full" | "light",
  showDead: boolean,
  root = tmpdir(),
): Promise<void> {
  await releaseLockFile(snapshotRefreshLockFile(enrichmentMode, showDead, root));
}

export async function releaseStatuslineRefreshLock(
  format: string,
  attentionLimit: number,
  width?: number,
  root = tmpdir(),
): Promise<void> {
  await releaseLockFile(statuslineRefreshLockFile(format, attentionLimit, width, root));
}

async function releaseLockFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // cache lock cleanup must never break command execution
  }
}

export async function acquireSnapshotRefreshLock(
  enrichmentMode: "full" | "light",
  showDead: boolean,
  root = tmpdir(),
): Promise<boolean> {
  return await acquireLockFile(
    snapshotRefreshLockFile(enrichmentMode, showDead, root),
    SNAPSHOT_LOCK_STALE_MS,
  );
}

export async function acquireStatuslineRefreshLock(
  format: string,
  attentionLimit: number,
  width?: number,
  root = tmpdir(),
): Promise<boolean> {
  return await acquireLockFile(
    statuslineRefreshLockFile(format, attentionLimit, width, root),
    STATUSLINE_REFRESH_LOCK_STALE_MS,
  );
}

async function acquireLockFile(path: string, staleMs: number): Promise<boolean> {
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch {
    return false;
  }

  try {
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          createdAt: Date.now(),
        }),
      );
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error)) {
      return false;
    }
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      return false;
    }

    try {
      const fileStat = await stat(path);
      if (Date.now() - fileStat.mtimeMs < staleMs) {
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
          JSON.stringify({
            pid: process.pid,
            createdAt: Date.now(),
            recovered: true,
          }),
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
