import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import * as OTPAuth from "otpauth";

export const PASSWORD_MIN_LENGTH = 8;

export function assertPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must contain at least ${PASSWORD_MIN_LENGTH} characters`);
  }
}

export function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function buildTotpUri(username: string, secret: string): string {
  return new OTPAuth.TOTP({
    issuer: "Voice Relay",
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).toString();
}

export function verifyTotp(secret: string, token: string): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const totp = new OTPAuth.TOTP({
    issuer: "Voice Relay",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.validate({ token, window: 1 }) !== null;
}

export function encryptTotpSecret(secret: string, masterKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptTotpSecret(value: string, masterKey: Buffer): string {
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted TOTP secret");
  const [ivPart, tagPart, encryptedPart] = parts;
  if (!ivPart || !tagPart || !encryptedPart) throw new Error("Invalid encrypted TOTP secret");
  const decipher = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
