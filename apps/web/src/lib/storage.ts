import { openDB, type DBSchema } from "idb";

export interface HistoryEntry {
  id: string;
  text: string;
  targetName: string;
  sentAt: number;
}

interface TrustRecord {
  deviceId: string;
  fingerprint: string;
  trustedAt: number;
}

interface VoiceRelayDb extends DBSchema {
  history: {
    key: string;
    value: HistoryEntry;
    indexes: { sentAt: number };
  };
  trust: {
    key: string;
    value: TrustRecord;
  };
}

const databasePromise = openDB<VoiceRelayDb>("voice-relay", 1, {
  upgrade(database) {
    const history = database.createObjectStore("history", { keyPath: "id" });
    history.createIndex("sentAt", "sentAt");
    database.createObjectStore("trust", { keyPath: "deviceId" });
  },
});

const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const HISTORY_MAX_COUNT = 100;

export async function getHistory(): Promise<HistoryEntry[]> {
  await pruneHistory();
  const database = await databasePromise;
  const entries = await database.getAllFromIndex("history", "sentAt");
  return entries.sort((left, right) => right.sentAt - left.sentAt);
}

export async function addHistory(entry: HistoryEntry): Promise<void> {
  const database = await databasePromise;
  await database.put("history", entry);
  await pruneHistory();
}

export async function deleteHistory(id: string): Promise<void> {
  const database = await databasePromise;
  await database.delete("history", id);
}

export async function clearHistory(): Promise<void> {
  const database = await databasePromise;
  await database.clear("history");
}

async function pruneHistory(now = Date.now()): Promise<void> {
  const database = await databasePromise;
  const entries = (await database.getAllFromIndex("history", "sentAt")).sort((left, right) => right.sentAt - left.sentAt);
  const transaction = database.transaction("history", "readwrite");
  await Promise.all(entries.map((entry, index) => {
    if (index >= HISTORY_MAX_COUNT || now - entry.sentAt > HISTORY_MAX_AGE_MS) return transaction.store.delete(entry.id);
    return Promise.resolve();
  }));
  await transaction.done;
}

export async function getTrustedFingerprint(deviceId: string): Promise<string | undefined> {
  return (await databasePromise).get("trust", deviceId).then((record) => record?.fingerprint);
}

export async function trustFingerprint(deviceId: string, fingerprint: string): Promise<void> {
  await (await databasePromise).put("trust", { deviceId, fingerprint, trustedAt: Date.now() });
}

export function loadDraft(): string {
  return localStorage.getItem("voice-relay:draft") ?? "";
}

export function saveDraft(text: string): void {
  localStorage.setItem("voice-relay:draft", text);
}

export function loadSelectedDevice(): string | undefined {
  return localStorage.getItem("voice-relay:selected-device") ?? undefined;
}

export function saveSelectedDevice(deviceId: string): void {
  localStorage.setItem("voice-relay:selected-device", deviceId);
}
