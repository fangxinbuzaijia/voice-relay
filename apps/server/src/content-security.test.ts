import assert from "node:assert/strict";
import test from "node:test";
import { createContentSecurityPolicy } from "./content-security.js";

test("CSP permits libsodium WebAssembly without permitting general eval", () => {
  const { scriptSrc } = createContentSecurityPolicy().directives;

  assert.ok(scriptSrc.includes("'wasm-unsafe-eval'"));
  assert.equal(scriptSrc.includes("'unsafe-eval'"), false);
});
