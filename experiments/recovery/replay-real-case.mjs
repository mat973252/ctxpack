import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Replay exact declarations from immutable history, without checking out or editing it.
const cwd = fileURLToPath(new URL("../../", import.meta.url));
const revisions = {
  baseline: "6e0c89555e6afb5f71c5f87812a679c97edcc057",
  candidate: "7cdd523c7b1d1aa23194855053c44e7644b08cf4",
};
function declaration(revision, file, name) {
  const source = execFileSync("git", ["show", `${revision}:${file}`], { cwd, encoding: "utf8" });
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const node = parsed.statements.find((statement) =>
    (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
    || (ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some((entry) => entry.name.getText(parsed) === name)));
  assert.ok(node, `Missing ${name} in ${revision}:${file}`);
  return { text: node.getText(parsed), evidence: {
    revision, file, symbol: name,
    startLine: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
    endLine: parsed.getLineAndCharacterOfPosition(node.end).line + 1,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
  } };
}

const results = [];
for (const [label, revision] of Object.entries(revisions)) {
  const template = declaration(revision, "src/core/init.ts", "MARKDOWN_TEMPLATES");
  const strip = declaration(revision, "src/core/handoff.ts", "stripTemplate");
  const compiled = ts.transpileModule(`${template.text}\n${strip.text}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports }, { timeout: 1000 });
  const cases = Object.entries(exports.MARKDOWN_TEMPLATES).map(([key, initial]) => {
    const userText = `My notes  \n\n\`\`\`markdown\n${initial}\`\`\``;
    const input = `${initial}\n${userText}\n`;
    const actual = exports.stripTemplate(input, key).join("\n");
    const crlfActual = exports.stripTemplate(input.replace(/\n/g, "\r\n"), key).join("\n");
    const preserved = actual === userText;
    assert.equal(preserved, label === "candidate");
    assert.equal(crlfActual === userText, label === "candidate");
    assert.equal(exports.stripTemplate(initial, key).length, 0);
    return { key, input, expected: userText, actual, crlfActual, preserved };
  });
  results.push({ label, revision, declarations: [template.evidence, strip.evidence], cases });
}
console.log(JSON.stringify({
  schema: "ctxpack.real-source-replay/1", node: process.version,
  scope: "Historical source declarations only; not a full CLI or model recovery trial",
  results,
}, null, 2));
