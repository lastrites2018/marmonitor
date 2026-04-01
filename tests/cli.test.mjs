import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "bin", "marmonitor.js");

function runCli(args) {
  return execFileSync("node", [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TERM_PROGRAM: "Ghostty",
    },
  });
}

describe("config CLI helpers", () => {
  it("prints config path metadata as JSON", () => {
    const output = runCli(["settings-path", "--json"]);
    const parsed = JSON.parse(output);
    assert.ok(parsed.configDir);
    assert.ok(parsed.defaultPath);
    assert.ok(Array.isArray(parsed.searchPaths));
  });

  it("prints the minimal config sample to stdout", () => {
    const output = runCli(["settings-init", "--stdout"]);
    const parsed = JSON.parse(output);
    assert.equal(parsed.display.attentionLimit, 10);
    assert.equal(parsed.integration.tmux.badgeStyle, "plain");
    assert.equal(parsed.integration.tmux.keys.attentionPopup, "a");
  });

  it("prints the advanced config sample to stdout", () => {
    const output = runCli(["settings-init", "--advanced", "--stdout"]);
    const parsed = JSON.parse(output);
    assert.equal(parsed.integration.tmux.badgeStyle, "plain");
    assert.equal(parsed.integration.wezterm.enabled, false);
    assert.equal(parsed.integration.banner.install, true);
    assert.ok(Array.isArray(parsed.paths.claudeProjects));
  });

  it("includes debug-phase in help output", () => {
    const output = runCli(["--help"]);
    assert.match(output, /debug-phase \[options\]/);
  });

  it("includes phase icon legend in help output", () => {
    const output = runCli(["--help"]);
    assert.match(output, /permission/);
    assert.match(output, /thinking/);
    assert.match(output, /tool/);
    assert.match(output, /done/);
    assert.match(output, /Active/);
    assert.match(output, /Stalled/);
  });

  it("documents tmux badge style in help output", () => {
    const output = runCli(["--help"]);
    assert.match(output, /integration\.tmux\.badgeStyle/);
    assert.match(output, /plain" \| "minimal" \| "pill/);
  });

  it("includes update-integration in help output", () => {
    const output = runCli(["--help"]);
    assert.match(output, /update-integration/);
  });
});

describe("postinstall/preuninstall scripts", () => {
  it("postinstall outputs install guide to stderr", () => {
    const output = execFileSync("node", [join(repoRoot, "bin", "postinstall.cjs")], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    // stderr is captured via shell redirect
    const merged = execFileSync(
      "sh",
      ["-c", `node "${join(repoRoot, "bin", "postinstall.cjs")}" 2>&1`],
      { encoding: "utf8" },
    );
    assert.match(merged, /marmonitor.*installed/);
    assert.match(merged, /marmonitor setup tmux/);
    assert.match(merged, /marmonitor status/);
    assert.match(merged, /uninstall-integration/);
  });

  it("preuninstall runs without error", () => {
    const output = execFileSync("node", [join(repoRoot, "bin", "preuninstall.cjs")], {
      encoding: "utf8",
    });
    // Should not throw. Output may be empty if no tmux.conf plugin line.
    assert.equal(typeof output, "string");
  });
});

describe("tmux integration diagnostics CLI", () => {
  it("prints unconfigured in quiet mode when no tmux wiring exists", async () => {
    const home = await mkdtemp(join(tmpdir(), "marmonitor-cli-home-"));
    try {
      const output = execFileSync("node", [cliPath, "update-integration", "--quiet"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          TERM_PROGRAM: "Ghostty",
          HOME: home,
        },
      });
      assert.equal(output.trim(), "unconfigured");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("prints local in quiet mode for local run-shell wiring", async () => {
    const home = await mkdtemp(join(tmpdir(), "marmonitor-cli-home-"));
    try {
      await writeFile(
        join(home, ".tmux.conf"),
        "run-shell ~/src/marmonitor/tmux/marmonitor.tmux\n",
      );
      const output = execFileSync("node", [cliPath, "update-integration", "--quiet"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          TERM_PROGRAM: "Ghostty",
          HOME: home,
        },
      });
      assert.equal(output.trim(), "local");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
