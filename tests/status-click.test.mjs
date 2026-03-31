import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractPidFromStatusRange, parseStatusClickArgs } from "../dist/status-click.js";

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
      pid: "99",
      configPath: "/tmp/marmonitor.json",
    });
  });
});
