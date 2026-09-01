import assert from "node:assert/strict";
import test from "node:test";
import { LoginLimiter } from "./login-limiter.js";

test("blocks after five failures within the window", () => {
  const limiter = new LoginLimiter();
  for (let index = 0; index < 5; index += 1) limiter.recordFailure("key", 1000 + index);
  assert.equal(limiter.isBlocked("key", 2000), true);
  limiter.clear("key");
  assert.equal(limiter.isBlocked("key", 2000), false);
});

