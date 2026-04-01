import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  resolveCliEntrypoint,
  resolveStatuslineEntrypoint,
} from "../dist/collector/entrypoints.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe("collector entrypoints", () => {
  it("falls back to an absolute cli entrypoint path", () => {
    const previousEnv = process.env.MARMONITOR_CLI_ENTRYPOINT;
    const previousArgv1 = process.argv[1];
    Reflect.deleteProperty(process.env, "MARMONITOR_CLI_ENTRYPOINT");
    process.argv[1] = join(repoRoot, "tests", "collector-entrypoints.test.mjs");
    try {
      assert.equal(resolveCliEntrypoint(), join(repoRoot, "bin", "marmonitor.js"));
    } finally {
      process.argv[1] = previousArgv1;
      if (previousEnv === undefined) {
        Reflect.deleteProperty(process.env, "MARMONITOR_CLI_ENTRYPOINT");
      } else {
        process.env.MARMONITOR_CLI_ENTRYPOINT = previousEnv;
      }
    }
  });

  it("falls back to an absolute statusline entrypoint path", () => {
    const previousEnv = process.env.MARMONITOR_STATUSLINE_ENTRYPOINT;
    const previousArgv1 = process.argv[1];
    Reflect.deleteProperty(process.env, "MARMONITOR_STATUSLINE_ENTRYPOINT");
    process.argv[1] = join(repoRoot, "tests", "collector-entrypoints.test.mjs");
    try {
      assert.equal(
        resolveStatuslineEntrypoint(),
        join(repoRoot, "bin", "marmonitor-statusline.js"),
      );
    } finally {
      process.argv[1] = previousArgv1;
      if (previousEnv === undefined) {
        Reflect.deleteProperty(process.env, "MARMONITOR_STATUSLINE_ENTRYPOINT");
      } else {
        process.env.MARMONITOR_STATUSLINE_ENTRYPOINT = previousEnv;
      }
    }
  });
});
