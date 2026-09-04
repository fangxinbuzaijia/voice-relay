import { PROTOCOL_VERSION, type DevicePresence } from "@voice-relay/protocol";
import sodium from "libsodium-wrappers";

export async function fingerprintPublicKey(publicKeyBase64: string): Promise<string> {
  await sodium.ready;
  const key = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
  const keyCopy = new Uint8Array(key);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", keyCopy.buffer));
  return Array.from(digest.slice(0, 10), (value) => value.toString(16).padStart(2, "0"))
    .join("")
    .match(/.{1,4}/g)?.join("-") ?? "";
}

export async function encryptTextForDevice(
  device: DevicePresence,
  text: string,
  messageId: string,
  sentAt: number,
  submitWithEnter = false,
): Promise<string> {
  await sodium.ready;
  const payload = {
    v: PROTOCOL_VERSION,
    messageId,
    sentAt,
    text,
    ...(submitWithEnter ? { submitWithEnter: true } : {}),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const publicKey = sodium.from_base64(device.publicKey, sodium.base64_variants.ORIGINAL);
  if (publicKey.length !== 32) throw new Error("invalid_device_key");
  const ciphertext = sodium.crypto_box_seal(bytes, publicKey);
  return sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL);
}

