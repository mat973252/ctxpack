import { describe, expect, it, vi } from "vitest";
import { DESCRIPTION, NAME, VERSION, createProgram } from "../src/program.js";

describe("createProgram", () => {
  it("has the expected name, version, and description", () => {
    const program = createProgram();
    expect(program.name()).toBe(NAME);
    expect(program.version()).toBe(VERSION);
    expect(program.description()).toBe(DESCRIPTION);
  });

  it("prints help when invoked with no arguments", () => {
    const program = createProgram();
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    program.parse(["node", "ctxpack"]);
    expect(write).toHaveBeenCalled();
    write.mockRestore();
  });
});
