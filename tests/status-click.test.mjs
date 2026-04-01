import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSummaryPopupTmuxArgs,
  extractPidFromStatusRange,
  findClickedAgent,
  parseStatusClickArgs,
  parseStatusClickTarget,
} from "../dist/status-click.js";

describe("status click helper", () => {
  it("extracts pid from a status range", () => {
    assert.equal(extractPidFromStatusRange("pid:12345"), "12345");
  });

  it("ignores invalid status ranges", () => {
    assert.equal(extractPidFromStatusRange("window:1"), undefined);
    assert.equal(extractPidFromStatusRange("pid:abc"), undefined);
    assert.equal(extractPidFromStatusRange(undefined), undefined);
  });

  it("parses config path alongside the clicked range", () => {
    assert.deepEqual(parseStatusClickArgs(["pid:99", "--config", "/tmp/marmonitor.json"]), {
      target: { kind: "pid", pid: 99 },
      configPath: "/tmp/marmonitor.json",
      targetClient: undefined,
    });
  });

  it("parses the clicked client tty alongside the range", () => {
    assert.deepEqual(
      parseStatusClickArgs([
        "pid:99",
        "--client-tty",
        "/dev/ttys032",
        "--config",
        "/tmp/marmonitor.json",
      ]),
      {
        target: { kind: "pid", pid: 99 },
        configPath: "/tmp/marmonitor.json",
        targetClient: "/dev/ttys032",
      },
    );
  });

  it("accepts --target-client as an alias for the target tty", () => {
    assert.deepEqual(parseStatusClickArgs(["pid:99", "--target-client", "/dev/ttys040"]), {
      target: { kind: "pid", pid: 99 },
      configPath: undefined,
      targetClient: "/dev/ttys040",
    });
  });

  it("parses summary click targets", () => {
    assert.deepEqual(parseStatusClickTarget("back"), {
      kind: "back",
    });
    assert.deepEqual(parseStatusClickTarget("sum:claude"), {
      kind: "summary",
      target: "agent:claude",
    });
    assert.deepEqual(parseStatusClickTarget("summary:agent:claude"), {
      kind: "summary",
      target: "agent:claude",
    });
    assert.deepEqual(parseStatusClickTarget("pid:42"), {
      kind: "pid",
      pid: 42,
    });
    assert.equal(parseStatusClickTarget("summary:unknown"), undefined);
  });

  it("parses summary click args alongside config and client tty", () => {
    assert.deepEqual(
      parseStatusClickArgs([
        "sum:think",
        "--client-tty",
        "/dev/ttys040",
        "--config",
        "/tmp/marmonitor.json",
      ]),
      {
        target: { kind: "summary", target: "phase:thinking" },
        configPath: "/tmp/marmonitor.json",
        targetClient: "/dev/ttys040",
      },
    );
  });

  it("parses jump-back click args alongside the clicked client tty", () => {
    assert.deepEqual(parseStatusClickArgs(["back", "--client-tty", "/dev/ttys040"]), {
      target: { kind: "back" },
      configPath: undefined,
      targetClient: "/dev/ttys040",
    });
  });

  it("finds the clicked agent by pid", () => {
    const sessions = [
      { pid: 10, cwd: "/repo/a", agentName: "Claude Code" },
      { pid: 20, cwd: "/repo/b", agentName: "Codex" },
    ];
    assert.deepEqual(findClickedAgent(sessions, 20), sessions[1]);
    assert.equal(findClickedAgent(sessions, 30), undefined);
  });

  it("opens summary popups as interactive choosers tied to popup lifetime", () => {
    const args = buildSummaryPopupTmuxArgs(
      "phase:thinking",
      "/tmp/marmonitor.json",
      "/dev/ttys040",
    );

    assert.equal(args[0], "display-popup");
    assert.equal(args.includes("-E"), true);
    assert.deepEqual(args.slice(1, 7), ["-E", "-w", "70%", "-h", "70%", "-c"]);
    assert.equal(args[7], "/dev/ttys040");
    assert.match(args.at(-1), /popup/);
    assert.match(args.at(-1), /--summary-target/);
    assert.match(args.at(-1), /--interactive/);
    assert.match(args.at(-1), /--target-client/);
  });
});
