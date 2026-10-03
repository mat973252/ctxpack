import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { id: { type: "string" }, repository: { type: "string" } } });
assert.ok(["ctx-fences", "lens-wal", "relay-clock", "permit-proxy"].includes(values.id) && values.repository,
  "--id historical case and --repository source repository required");
const material = JSON.parse(execFileSync(process.execPath,
  [fileURLToPath(new URL("materialize-historical-case.mjs", import.meta.url)), values.id, values.repository], { encoding: "utf8" }));
const root = mkdtempSync(join(tmpdir(), `historical-image-${values.id}-`));
const context = join(root, "context");
const workspace = join(context, "workspace");
mkdirSync(workspace, { recursive: true });
const archive = join(root, "canonical.tar");
// Export committed blobs with LF, including the POSIX Maven Wrapper; no .git or host dependencies.
execFileSync("git", ["-c", "core.autocrlf=false", "archive", "--format=tar", `--output=${archive}`, "HEAD"], { cwd: material.workspace });
execFileSync("tar", ["-xf", archive, "-C", workspace]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = {};
function walk(directory) {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    assert.equal(stat.isSymbolicLink(), false, "Unexpected material symlink");
    if (stat.isDirectory()) walk(path);
    else files[relative(workspace, path).split("\\").join("/")] = hash(readFileSync(path));
  }
}
walk(workspace);
const pnpm = values.id === "permit-proxy" ? null : values.id === "relay-clock" ? "10.33.0" : "10.17.1";
copyFileSync(new URL(`Historical${pnpm ? "Node" : "Java"}.Containerfile`, import.meta.url), join(context, "Containerfile"));
if (!pnpm) assert.equal(readFileSync(join(workspace, "mvnw"), "utf8").includes("\r"), false);
const manifest = join(root, "manifest.json");
writeFileSync(manifest, JSON.stringify({ id: values.id, pnpm, context, material, files,
  canonicalArchiveSha256: hash(readFileSync(archive)), containerfileSha256: hash(readFileSync(join(context, "Containerfile"))) }, null, 2) + "\n");
console.log(JSON.stringify({ id: values.id, pnpm, context, manifest, fileCount: Object.keys(files).length }));
