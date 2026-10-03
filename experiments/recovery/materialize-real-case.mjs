import { execFileSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import assert from "node:assert/strict";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const baseline = "6e0c89555e6afb5f71c5f87812a679c97edcc057";
const directory = mkdtempSync(join(tmpdir(), "ctxpack-real-recovery-"));
const workspace = join(directory, "workspace");
mkdirSync(workspace);
const archive = join(directory, "baseline.tar");
execFileSync("git", ["archive", "--format=tar", `--output=${archive}`, baseline], { cwd: repository });
execFileSync("tar", ["-xf", archive, "-C", workspace]);
for (const excluded of [".git", "dist", ".ctxpack", "experiments", "node_modules"]) {
  assert.equal(existsSync(join(workspace, excluded)), false, `Unexpected ${excluded} in baseline`);
}
const regression = readFileSync(new URL("real-task-regression.txt", import.meta.url));
writeFileSync(join(workspace, "tests/recovery-case.test.ts"), regression);
execFileSync("git", ["init", "-q", "-b", "mat/recovery-case"], { cwd: workspace });
execFileSync("git", ["add", "--all"], { cwd: workspace });
execFileSync("git", ["-c", "user.name=Recovery fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "Baseline plus frozen recovery acceptance"], { cwd: workspace });
const manifest = {
  schema: "ctxpack.real-recovery-material/1", baseline,
  baselineArchiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
  regressionSha256: createHash("sha256").update(regression).digest("hex"),
  workspace,
  note: "No solution/history/dependency link copied. Filesystem access isolation still required before model sampling.",
};
writeFileSync(join(directory, "material.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
