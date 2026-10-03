import { replaceFunctionBody } from "./historical-edits.mjs";

export function replaceBody(original, body) {
  return replaceFunctionBody(original, body, "stripTemplate");
}
