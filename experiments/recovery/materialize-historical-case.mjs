import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import ts from "typescript";

// Controller-only history and acceptance sources. Never expose this file to participants.
const cases = {
  "ctx-fences": {
    baseline: "6e0c89555e6afb5f71c5f87812a679c97edcc057",
    reference: "7cdd523c7b1d1aa23194855053c44e7644b08cf4",
    source: "src/core/handoff.ts",
    test: "tests/recovery-fences.test.ts",
  },
  "lens-wal": {
    baseline: "784c511b89982472f4d09bc624536b030ae16be2",
    reference: "5e5cf3da3cf9cdc5ec5b5bbc425869da53a7579d",
    source: "src/storage/sqlite/store.ts",
    test: "tests/incremental-recorder.test.ts",
  },
  "relay-clock": {
    baseline: "934d5dbe1dfcb8181910dc201b66eaa818d5b1a6",
    reference: "e51d518c7fc5574c6d6c2cf52d09bcb096d828bc",
    source: "packages/mcp/test/business-sandbox.test.ts",
    test: "packages/mcp/test/business-sandbox.test.ts",
  },
  "permit-proxy": {
    baseline: "7b90a6ea936a98b90b7cea2a1511161cda2b9fc9",
    reference: "c113515bad05919aab18b1da496cfac86a42bad9",
    source: "agent-permit-spring-ai/src/main/java/io/github/agentpermit4j/springai/GuardedToolMethods.java",
    test: "agent-permit-spring-ai/src/test/java/io/github/agentpermit4j/springai/consumer/GuardedToolMethodsAcceptanceTest.java",
  },
};
const [id, repositoryArgument, ...extra] = process.argv.slice(2);
assert.ok(Object.hasOwn(cases, id ?? "") && repositoryArgument && extra.length === 0,
  "Usage: node materialize-historical-case.mjs <ctx-fences|lens-wal|relay-clock|permit-proxy> <repository>");
const spec = cases[id];
const repository = resolve(repositoryArgument);
const git = (...args) => execFileSync("git", args, { cwd: repository });
for (const revision of [spec.baseline, spec.reference])
  assert.equal(git("rev-parse", `${revision}^{commit}`).toString().trim(), revision);
const directory = mkdtempSync(join(tmpdir(), `recovery-${id}-`));
const workspace = join(directory, "workspace");
mkdirSync(workspace);
const archive = join(directory, "baseline.tar");
git("archive", "--format=tar", `--output=${archive}`, spec.baseline);
execFileSync("tar", ["-xf", archive, "-C", workspace]);
for (const excluded of [".git", "dist", ".ctxpack", "experiments", "node_modules"])
  assert.equal(existsSync(join(workspace, excluded)), false, `Unexpected ${excluded} in baseline`);
let regression = id === "ctx-fences"
  ? readFileSync(new URL("real-fences-regression.txt", import.meta.url), "utf8")
  : git("show", `${spec.reference}:${spec.test}`).toString();
if (id === "relay-clock") {
  // The implementation shares a file with its tests. Overlay the tests, retain the old helper.
  const baseline = git("show", `${spec.baseline}:${spec.source}`).toString();
  function untilRange(text) {
    const file = ts.createSourceFile("task.ts", text, ts.ScriptTarget.Latest, true);
    const declarations = file.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === "until");
    assert.equal(declarations.length, 1);
    return [declarations[0].getStart(file), declarations[0].end];
  }
  const [oldStart, oldEnd] = untilRange(baseline);
  const [newStart, newEnd] = untilRange(regression);
  regression = regression.slice(0, newStart) + baseline.slice(oldStart, oldEnd) + regression.slice(newEnd);
}
writeFileSync(join(workspace, spec.test), regression);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (spec.source !== spec.test)
  assert.equal(hash(readFileSync(join(workspace, spec.source)).toString().replace(/\r\n/g, "\n")),
    hash(git("show", `${spec.baseline}:${spec.source}`).toString().replace(/\r\n/g, "\n")));
execFileSync("git", ["init", "-q", "-b", "mat/recovery-case"], { cwd: workspace });
execFileSync("git", ["add", "--all"], { cwd: workspace });
execFileSync("git", ["-c", "user.name=Recovery fixture", "-c", "user.email=fixture@example.invalid",
  "-c", "commit.gpgsign=false", "commit", "-qm", "Baseline plus frozen recovery acceptance"], { cwd: workspace });
const manifest = {
  schema: "ctxpack.historical-recovery-material/1", id, ...spec,
  baselineArchiveSha256: hash(readFileSync(archive)), regressionSha256: hash(regression),
  sourceSha256: hash(readFileSync(join(workspace, spec.source))), workspace,
  note: "Controller metadata only. No model invoked; access isolation, execution environment and acceptance remain to verify.",
};
writeFileSync(join(directory, "material.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
