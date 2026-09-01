import assert from "node:assert/strict";
import test from "node:test";
import { countUtf16CodeUnits, parseClientFrame } from "./index.js";

test("counts UTF-16 code units", () => {
  assert.equal(countUtf16CodeUnits("中文😀"), 4);
});

test("rejects an unversioned frame", () => {
  assert.throws(() => parseClientFrame({ type: "heartbeat", at: Date.now() }));
});

