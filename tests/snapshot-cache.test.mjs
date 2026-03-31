import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  acquireSnapshotRefreshLock,
  acquireStatuslineRefreshLock,
  readCacheFile,
  releaseSnapshotRefreshLock,
  releaseStatuslineRefreshLock,
  snapshotRefreshLockFile,
  statuslineRefreshLockFile,
  writeCacheFileAtomically,
} from "../dist/snapshot-cache.js";

describe("snapshot refresh lock", () => {
  it("creates the lock parent directory on a fresh temp root", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-snapshot-lock-"));
    const acquired = await acquireSnapshotRefreshLock("light", false, root);

    assert.equal(acquired, true);
    await stat(snapshotRefreshLockFile("light", false, root));

    await releaseSnapshotRefreshLock("light", false, root);
  });

  it("writes cache files atomically without leaving temp files behind", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-snapshot-write-"));
    const path = join(root, "marmonitor", "statusline.txt");

    await writeCacheFileAtomically(path, "first");
    assert.equal(await readFile(path, "utf8"), "first");

    await writeCacheFileAtomically(path, "second");
    assert.equal(await readFile(path, "utf8"), "second");

    const entries = await readdir(dirname(path));
    assert.deepEqual(entries, ["statusline.txt"]);
  });

  it("reads cache entries with freshness metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-cache-read-"));
    const path = join(root, "marmonitor", "statusline.txt");

    await writeCacheFileAtomically(path, "cached-value");
    const fresh = await readCacheFile(path, 10_000, (raw) => raw);
    assert.equal(fresh?.value, "cached-value");
    assert.equal(fresh?.fresh, true);

    const staleAt = new Date(Date.now() - 20_000);
    await utimes(path, staleAt, staleAt);
    const stale = await readCacheFile(path, 5_000, (raw) => raw);
    assert.equal(stale?.value, "cached-value");
    assert.equal(stale?.fresh, false);
    assert.ok((stale?.ageMs ?? 0) >= 5_000);
  });

  it("creates and releases a dedicated statusline refresh lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-statusline-lock-"));
    const acquired = await acquireStatuslineRefreshLock("compact", 5, 120, root);

    assert.equal(acquired, true);
    await stat(statuslineRefreshLockFile("compact", 5, 120, root));

    await releaseStatuslineRefreshLock("compact", 5, 120, root);
  });
});
