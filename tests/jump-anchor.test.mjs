import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  clearJumpAnchor,
  listJumpAnchorClientIds,
  pruneJumpAnchors,
  readJumpAnchor,
  writeJumpAnchor,
} from "../dist/tmux/jump-anchor.js";

describe("tmux jump anchors", () => {
  it("writes and reads an anchor by client id", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-jump-anchor-"));
    await writeJumpAnchor(
      {
        clientId: "$3",
        clientTty: "/dev/ttys017",
        originSessionId: "$1",
        originWindowId: "@41",
        originPaneId: "%118",
        recordedAt: Date.now(),
      },
      root,
    );

    const anchor = await readJumpAnchor("$3", root);
    assert.equal(anchor?.clientId, "$3");
    assert.equal(anchor?.originPaneId, "%118");
  });

  it("clears an anchor when requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-jump-anchor-clear-"));
    await writeJumpAnchor(
      {
        clientId: "$4",
        originSessionId: "$1",
        originWindowId: "@41",
        originPaneId: "%118",
        recordedAt: Date.now(),
      },
      root,
    );

    await clearJumpAnchor("$4", root);
    const anchor = await readJumpAnchor("$4", root);
    assert.equal(anchor, undefined);
  });

  it("prunes anchors for clients that no longer exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-jump-anchor-prune-"));
    await writeJumpAnchor(
      {
        clientId: "$3",
        originSessionId: "$1",
        originWindowId: "@41",
        originPaneId: "%118",
        recordedAt: Date.now(),
      },
      root,
    );
    await writeJumpAnchor(
      {
        clientId: "$9",
        originSessionId: "$2",
        originWindowId: "@99",
        originPaneId: "%404",
        recordedAt: Date.now(),
      },
      root,
    );

    await pruneJumpAnchors({
      activeClientIds: ["$3"],
      root,
    });

    assert.deepEqual(await listJumpAnchorClientIds(root), ["$3"]);
  });

  it("prunes anchors that exceed the max age", async () => {
    const root = await mkdtemp(join(tmpdir(), "marmonitor-jump-anchor-age-"));
    await writeJumpAnchor(
      {
        clientId: "$5",
        originSessionId: "$1",
        originWindowId: "@41",
        originPaneId: "%118",
        recordedAt: Date.now() - 25 * 60 * 60 * 1000,
      },
      root,
    );

    await pruneJumpAnchors({
      now: Date.now(),
      root,
    });

    assert.equal(await readJumpAnchor("$5", root), undefined);
  });
});
