import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPasswordPolicy,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  hashPassword,
  verifyPassword,
} from "./security.js";

test("accepts eight-character passwords and rejects shorter values", () => {
  assert.doesNotThrow(() => assertPasswordPolicy("12345678"));
  assert.throws(() => assertPasswordPolicy("1234567"), /at least 8/);
});

test("encrypts and decrypts a TOTP secret", () => {
  const key = Buffer.alloc(32, 7);
  const secret = generateTotpSecret();
  const encrypted = encryptTotpSecret(secret, key);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptTotpSecret(encrypted, key), secret);
});

test("hashes passwords with Argon2id", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword(hash, "correct horse battery staple"), true);
  assert.equal(await verifyPassword(hash, "wrong password"), false);
});
