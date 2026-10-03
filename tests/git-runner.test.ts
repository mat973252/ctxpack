import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitRunner } from "../src/git/index.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("Git subprocess diagnostics", () => {
  it.each(["EPERM", "EACCES"])("retains %s when Git cannot start and has no stderr", (code) => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw Object.assign(new Error(`spawnSync git ${code}`), { code, status: null, stderr: null });
    });
    expect(() => createGitRunner(".")(["rev-parse", "--is-inside-work-tree"]))
      .toThrow(`git process could not start (${code})`);
  });
});
