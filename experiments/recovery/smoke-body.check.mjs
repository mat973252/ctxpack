import assert from "node:assert/strict";
import { test } from "node:test";
import { replaceBody } from "./smoke-body.mjs";

test("body editing preserves surrounding bytes and rejects scope escape", () => {
  const original = 'const marker = 1;\r\nexport function stripTemplate(markdown: string): string[] { return []; }\r\nconst tail = 2;\r\n';
  const updated = replaceBody(original, 'return [markdown];');
  assert.equal(updated, original.replace(' return []; ', '\nreturn [markdown];\n'));
  for (const body of ['return []; }\nconst escaped = true;\nfunction other() {', '/* unfinished', 'x'.repeat(8001)]) {
    assert.throws(() => replaceBody(original, body));
  }
});
