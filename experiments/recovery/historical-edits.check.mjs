import assert from "node:assert/strict";
import { test } from "node:test";
import { applyHistoricalEdit, parseJavaScope, replaceFunctionBody, replaceRunReader, replaceProxyBodies } from "./historical-edits.mjs";

const functions = '\uFEFF// 中文\r\nexport function stripTemplate(s: string): string[] { return []; }\r\nfunction parseList<T>(s: string): T[] { return []; }\r\nasync function until(check: () => boolean): Promise<void> { void check; }\r\nconst tail = 2; /* end */';
for (const name of ["stripTemplate", "parseList", "until"]) {
  test(`${name}: preserve every byte outside the body and handle braces as syntax`, () => {
    const originalBody = name === "until" ? " void check; " : " return []; ";
    const begin = functions.indexOf(originalBody, functions.indexOf(`function ${name}`));
    const body = 'const x = "}"; /* } */ const re = /[{}]/; void re; void x; // tail';
    assert.equal(replaceFunctionBody(functions, body, name), functions.slice(0, begin) + `\n${body}\n` + functions.slice(begin + originalBody.length));
    for (const escape of ['return []; }\nconst escaped = true;\nfunction other() {', 'return []; }\nconst escaped = true; /*', '/* unfinished', 'const x = `unfinished', 'if (true) {']) {
      assert.throws(() => replaceFunctionBody(functions, escape, name));
    }
  });
}
test("function edit refuses invalid baselines, duplicate declarations and oversized input", () => {
  for (const source of ["function parseList(): void;", "function outer() { function parseList() {} }", "function parseList() {} function parseList() {}", "function parseList( {} "]) {
    assert.throws(() => replaceFunctionBody(source, "", "parseList"));
  }
  assert.throws(() => replaceFunctionBody(functions, "", "other"));
  assert.throws(() => replaceFunctionBody(functions, null, "parseList"));
  assert.throws(() => replaceFunctionBody(functions, " ".repeat(8001), "parseList"));
  assert.ok(replaceFunctionBody(functions, " ".repeat(8000), "parseList"));
  assert.throws(() => applyHistoricalEdit("ctx-fences", functions, { body: "", extra: "" }));
});

const reader = '// 中文\r\nexport class SqliteTraceStore {\r\n  constructor(private db: unknown) {}\r\n  getRun(id: string): Run { return old(id); }\r\n  close(): void { unchanged(); }\r\n}\r\nconst outside = true; /* end */';
test("reader edit permits a body and private methods, preserving its signature and other members", () => {
  const helpers = '\n\n  private readSnapshot(id: string): Run { return old(id); }';
  const body = '\n    return this.readSnapshot(id);\n  ';
  assert.equal(replaceRunReader(reader, body, helpers), reader.replace(' return old(id); }', `${body}}${helpers}`));
  assert.ok(replaceRunReader(reader, 'return old(id); // comment\n', ''));
});
test("reader edit rejects member injection, shadowing and all executable initializers outside methods", () => {
  for (const helpers of [
    'private field = sideEffect();', 'static { sideEffect(); }', 'private static read() {}',
    'private get read() { return 1; }', 'private set read(x: number) {}', 'constructor() {}',
    'private close() {}', 'private getRun() {}', 'private a() {} private a() {}',
    'private [sideEffect()]() {}', '@sideEffect() private read() {}', 'private #read() {}',
    'private helper(@(() => { sideEffect(); return () => {}; })() value: unknown) {}',
    'private *read() {}', 'private read(): void;', 'private read() {} } const outside = sideEffect(); class Other {',
    'private read() {} } /*',
  ]) assert.throws(() => replaceRunReader(reader, 'return old(id);', helpers), helpers);
  assert.throws(() => replaceRunReader(reader, '} private injected() {} getRun(id: string): Run { return old(id);', ''));
  assert.throws(() => replaceRunReader(reader, '} /*', ''));
});

const java = `package sample;
import java.util.List;
public final class GuardedToolMethods {
  private GuardedToolMethods() {}
  public static Object fromAnnotated(Object dependencies, Object... targets) { return null; }
  private static Object create(Object dependencies, Object target, Object method) { return null; }
  private static void unchanged() { }
}
`;
test("Java parser only parses and accepts missing types without resolving or executing them", () => {
  const parsed = parseJavaScope(java.replace('return null;', 'NeverDefined value = new NeverDefined(); return value;'));
  assert.equal(parsed.memberCount, 4);
  assert.equal(parsed.importCount, 1);
});
test("Java edit preserves declarations and all other bytes, allowing plain added imports", () => {
  const edit = { fromAnnotated: 'return List.of("}"); // brace', create: 'return target;', imports: ['java.util.Map'] };
  const expected = java.replace('import java.util.List;', 'import java.util.List;\nimport java.util.Map;')
    .replace(' { return null; }', ` {\n${edit.fromAnnotated}\n}`)
    .replace(' { return null; }', ` {\n${edit.create}\n}`);
  assert.equal(replaceProxyBodies(java, edit), expected);
});
test("Java edit refuses early closure, initializers, swallowed tail and Unicode escapes", () => {
  for (const body of [
    'return null; } static { System.exit(0); } private static void added() {',
    'return null; } /*', 'return null; } private static Object fromAnnotated(Object x) {',
    String.raw`return null; \u007d static { System.exit(0); }`,
  ]) assert.throws(() => replaceProxyBodies(java, { fromAnnotated: body, create: 'return null;', imports: [] }));
  for (const imports of [['java.util.*'], ['static java.lang.System.out'], ['java.util.Map; class Escape {}'], ['java.util.Map', 'java.util.Map']]) {
    assert.throws(() => replaceProxyBodies(java, { fromAnnotated: '', create: '', imports }));
  }
});
