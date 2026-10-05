import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const [{ marketClasses, TEXT_WIDTH }, { MESSAGES }] = await Promise.all([import("../src/city/scene-data.ts"), import("../src/city/messages.ts")]);

const classes = (text: string) => [...marketClasses(text)].join("");

test("ticker market classes colour signed figures only", () => {
  assert.equal(classes("KOWA -1.07% NAMI +0.88%"), "00000" + "222222" + "000000" + "111111");
  assert.equal(classes("+4 X"), "1100");
  // Phone numbers, times and dashes between words stay neutral.
  assert.equal(classes("CALL 0800-555-2049"), "0".repeat(18));
  assert.equal(classes("02:00 - 05:00"), "0".repeat(13));
  assert.equal(classes("A // B"), "000000");
});

test("every message fits one text row and its class row", () => {
  for (const message of MESSAGES) {
    assert.ok(message.length < TEXT_WIDTH, message);
    assert.equal(marketClasses(message).length, message.length);
  }
});
