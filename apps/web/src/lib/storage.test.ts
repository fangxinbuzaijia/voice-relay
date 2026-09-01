import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addHistory,
  clearHistory,
  getHistory,
  getTrustedFingerprint,
  trustFingerprint,
} from "./storage";

describe("local browser persistence", () => {
  beforeEach(async () => clearHistory());

  it("keeps at most 100 history entries and removes entries older than 30 days", async () => {
    const now = Date.now();
    await addHistory({ id: "expired", text: "old", targetName: "PC", sentAt: now - 31 * 24 * 60 * 60 * 1_000 });
    for (let index = 0; index < 101; index += 1) {
      await addHistory({ id: `message-${index}`, text: String(index), targetName: "PC", sentAt: now - index });
    }

    const entries = await getHistory();
    expect(entries).toHaveLength(100);
    expect(entries.some((entry) => entry.id === "expired")).toBe(false);
    expect(entries[0]?.id).toBe("message-0");
  });

  it("stores the trusted fingerprint by device ID", async () => {
    await trustFingerprint("device-1", "abcd-1234");
    expect(await getTrustedFingerprint("device-1")).toBe("abcd-1234");
    expect(await getTrustedFingerprint("device-2")).toBeUndefined();
  });
});
