import { Buffer } from "node:buffer";
import path from "node:path";
import { z } from "zod";
import { loadOrCreateMasterKey, migrateLegacyDatabase } from "./bootstrap.js";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DB_PATH: z.string().default(path.resolve("data/voice-relay.db")),
  MASTER_KEY: z.string().optional(),
  LEGACY_DATA_DIR: z.string().optional(),
  WEB_ROOT: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema> & {
  dataDirectory: string;
  masterKeyBytes: Buffer;
  masterKeyPath: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.parse(environment);
  const dbPath = path.resolve(parsed.DB_PATH);
  migrateLegacyDatabase(dbPath, parsed.LEGACY_DATA_DIR);
  const key = loadOrCreateMasterKey(dbPath, parsed.MASTER_KEY);
  return {
    ...parsed,
    DB_PATH: dbPath,
    dataDirectory: path.dirname(dbPath),
    masterKeyBytes: key.bytes,
    masterKeyPath: key.path,
  };
}
