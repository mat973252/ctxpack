import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

function text(value, maximum = 16000) {
  assert.ok(typeof value === "string" && value.length <= maximum, "Invalid edit text");
  return value;
}

function parse(source) {
  const file = ts.createSourceFile("task.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length, 0, "Invalid TypeScript");
  return file;
}

function one(nodes, predicate) {
  const matches = nodes.filter(predicate);
  assert.equal(matches.length, 1, "Expected one editable declaration");
  return matches[0];
}

export function replaceFunctionBody(original, body, name) {
  assert.ok(["stripTemplate", "parseList", "until"].includes(name));
  text(body, 8000);
  const source = parse(original);
  const find = (file) => one(file.statements, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const before = find(source);
  assert.ok(before.body);
  const start = before.body.getStart(source) + 1;
  const end = before.body.end - 1;
  const inserted = `\n${body}\n`;
  const candidate = original.slice(0, start) + inserted + original.slice(end);
  const parsed = parse(candidate);
  const after = find(parsed);
  assert.equal(after.body?.getStart(parsed), start - 1);
  assert.equal(after.body?.end, start + inserted.length + 1, "Body escaped its function");
  assert.equal(parsed.statements.length, source.statements.length);
  return candidate;
}

export function replaceRunReader(original, body, helpers) {
  text(body); text(helpers);
  const source = parse(original);
  const findClass = (file) => one(file.statements, (node) => ts.isClassDeclaration(node) && node.name?.text === "SqliteTraceStore");
  const owner = findClass(source);
  const findRun = (members) => one(members, (node) => ts.isMethodDeclaration(node) && node.name.getText() === "getRun");
  const before = findRun(owner.members);
  assert.ok(before.body);
  const helperFile = parse(`class Helpers {\n${helpers}\n}`);
  assert.equal(helperFile.statements.length, 1);
  assert.ok(ts.isClassDeclaration(helperFile.statements[0]));
  const additions = helperFile.statements[0].members;
  assert.ok(additions.length <= 4);
  const names = new Set(owner.members.filter((node) => node.name).map((node) => node.name.getText()));
  for (const node of additions) {
    assert.ok(ts.isMethodDeclaration(node) && node.body && ts.isIdentifier(node.name));
    assert.equal(node.modifiers?.length, 1);
    assert.equal(node.modifiers[0].kind, ts.SyntaxKind.PrivateKeyword);
    assert.ok(!node.asteriskToken && !node.questionToken && node.name.text !== "constructor");
    assert.ok(node.parameters.every((parameter) => !parameter.modifiers?.length), "Parameter decorators are not method bodies");
    assert.ok(!names.has(node.name.text), "Helper shadows a member");
    names.add(node.name.text);
  }
  const start = before.body.getStart(source) + 1;
  const end = before.body.end - 1;
  // Preserve caller-supplied whitespace: this task uses Biome's exact formatting check.
  const inserted = body;
  const appended = helpers;
  const candidate = original.slice(0, start) + inserted + original.slice(end, before.end) + appended + original.slice(before.end);
  const parsed = parse(candidate);
  const nextOwner = findClass(parsed);
  const after = findRun(nextOwner.members);
  assert.equal(after.body?.getStart(parsed), start - 1);
  assert.equal(after.body?.end, start + inserted.length + 1, "Body escaped getRun");
  assert.equal(parsed.statements.length, source.statements.length);
  assert.equal(nextOwner.members.length, owner.members.length + additions.length);
  const index = owner.members.indexOf(before);
  assert.equal(nextOwner.members[index], after);
  const insertedMembers = nextOwner.members.slice(index + 1, index + 1 + additions.length);
  assert.deepEqual(insertedMembers.map((node) => node.getText(parsed)), additions.map((node) => node.getText(helperFile)));
  const remaining = [...nextOwner.members.slice(0, index), ...nextOwner.members.slice(index + 1 + additions.length)];
  assert.deepEqual(remaining.map((node) => node.getText(parsed)), owner.members.filter((node) => node !== before).map((node) => node.getText(source)));
  // Comments in helper text must not consume the original class tail.
  assert.equal(nextOwner.end, owner.end + inserted.length - (end - start) + appended.length);
  return candidate;
}

export function parseJavaScope(source) {
  text(source, 200000);
  // javac processes Unicode escapes before tokenization, including in comments.
  assert.ok(!/\\u+[0-9a-fA-F]{4}/.test(source), "Unicode escapes are outside this task's edit protocol");
  return JSON.parse(execFileSync("java", [fileURLToPath(new URL("./JavaEditScope.java", import.meta.url))], {
    input: source, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true,
  }));
}

export function replaceProxyBodies(original, edit, parseScope = parseJavaScope) {
  assert.deepEqual(Object.keys(edit).sort(), ["create", "fromAnnotated", "imports"]);
  text(edit.fromAnnotated); text(edit.create);
  assert.ok(Array.isArray(edit.imports) && edit.imports.length <= 4);
  assert.equal(new Set(edit.imports).size, edit.imports.length);
  for (const name of edit.imports) assert.ok(typeof name === "string" && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(name));
  const before = parseScope(original);
  const changes = [
    { start: before.importEnd, end: before.importEnd, value: edit.imports.map((name) => `\nimport ${name};`).join("") },
    ...["fromAnnotated", "create"].map((name) => ({ name, start: before[name].bodyStart + 1, end: before[name].bodyEnd - 1, value: `\n${edit[name]}\n` })),
  ].sort((a, b) => a.start - b.start);
  let offset = 0;
  let cursor = 0;
  let candidate = "";
  for (const change of changes) {
    assert.ok(change.start >= cursor && change.end >= change.start);
    candidate += original.slice(cursor, change.start) + change.value;
    change.expectedStart = change.start + offset;
    offset += change.value.length - (change.end - change.start);
    cursor = change.end;
  }
  candidate += original.slice(cursor);
  const after = parseScope(candidate);
  assert.equal(after.importCount, before.importCount + edit.imports.length);
  assert.equal(after.memberCount, before.memberCount);
  for (const change of changes.filter((item) => item.name)) {
    assert.equal(after[change.name].bodyStart + 1, change.expectedStart);
    assert.equal(after[change.name].bodyEnd - 1, change.expectedStart + change.value.length, "Body escaped its Java method");
  }
  return candidate;
}

export function applyHistoricalEdit(id, original, edit) {
  const functions = { "markdown-text": "stripTemplate", "ctx-fences": "parseList", "relay-clock": "until" };
  if (Object.hasOwn(functions, id)) {
    assert.deepEqual(Object.keys(edit), ["body"]);
    return replaceFunctionBody(original, edit.body, functions[id]);
  }
  if (id === "lens-wal") {
    assert.deepEqual(Object.keys(edit).sort(), ["body", "helpers"]);
    return replaceRunReader(original, edit.body, edit.helpers);
  }
  assert.equal(id, "permit-proxy");
  return replaceProxyBodies(original, edit);
}
