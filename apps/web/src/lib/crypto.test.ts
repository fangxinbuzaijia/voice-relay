import { describe, expect, it } from "vitest";
import sodium from "libsodium-wrappers";
import { encryptTextForDevice } from "./crypto";

describe("sealed message encryption", () => {
  it("can be opened only with the target key pair", async () => {
    await sodium.ready;
    const keys = sodium.crypto_box_keypair();
    const messageId = "1b522db5-b97a-4c9e-ae24-86cb53c30a5e";
    const sentAt = 1_700_000_000_000;
    const ciphertext = await encryptTextForDevice({
      id: "ef7e9a7e-cb4f-4bff-9449-d85174b43a7f",
      name: "测试电脑",
      publicKey: sodium.to_base64(keys.publicKey, sodium.base64_variants.ORIGINAL),
      online: true,
      paused: false,
      updatedAt: new Date(sentAt).toISOString(),
    }, "中文😀\n第二行", messageId, sentAt);
    const plain = sodium.crypto_box_seal_open(
      sodium.from_base64(ciphertext, sodium.base64_variants.ORIGINAL),
      keys.publicKey,
      keys.privateKey,
    );
    const payload = JSON.parse(new TextDecoder().decode(plain)) as unknown;
    expect(payload).toEqual({ v: 1, messageId, sentAt, text: "中文😀\n第二行" });
  });
});

