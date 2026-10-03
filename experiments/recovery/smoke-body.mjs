import assert from "node:assert/strict";
import ts from "typescript";

export function replaceBody(original, body) {
  assert.ok(typeof body === "string" && body.length <= 8000, "Invalid body");
  const parse = (text) => ts.createSourceFile("handoff.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const source = parse(original);
  const find = (file) => file.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === "stripTemplate");
  const [before] = find(source);
  assert.ok(before?.body);
  const start = before.body.getStart(source) + 1;
  const end = before.body.end - 1;
  const inserted = `\n${body}\n`;
  const candidate = original.slice(0, start) + inserted + original.slice(end);
  const parsed = parse(candidate);
  assert.equal(parsed.parseDiagnostics.length, 0, "Invalid TypeScript");
  assert.equal(find(parsed).length, 1);
  const after = find(parsed)[0];
  assert.equal(after.body.getStart(parsed), start - 1);
  assert.equal(after.body.end, start + inserted.length + 1, "Body escaped its function");
  assert.equal(parsed.statements.length, source.statements.length);
  return candidate;
}
