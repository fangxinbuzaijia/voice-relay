import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_TEXT_CODE_UNITS = 10_000;
export const SEND_CLOCK_SKEW_MS = 30_000;
export const ACK_TIMEOUT_MS = 5_000;
export const HEARTBEAT_INTERVAL_MS = 20_000;
export const OFFLINE_AFTER_MS = 45_000;

export const clientTypeSchema = z.enum(["web", "windows"]);
export type ClientType = z.infer<typeof clientTypeSchema>;

export const devicePresenceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(64),
  publicKey: z.string().base64(),
  online: z.boolean(),
  paused: z.boolean(),
  updatedAt: z.string(),
});
export type DevicePresence = z.infer<typeof devicePresenceSchema>;

export const authFrameSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal("auth"),
  accessToken: z.string().min(32),
  clientType: clientTypeSchema,
  deviceId: z.uuid().optional(),
});

export const heartbeatFrameSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal("heartbeat"),
  at: z.number().int(),
});

export const textSendFrameSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal("text.send"),
  messageId: z.uuid(),
  targetDeviceId: z.uuid(),
  sentAt: z.number().int(),
  ciphertext: z.string().base64(),
});

export const ackStatusSchema = z.enum([
  "injected",
  "paused",
  "desktop_locked",
  "no_foreground_window",
  "target_elevated",
  "modifier_pressed",
  "clipboard_busy",
  "focus_changed",
  "decrypt_failed",
  "invalid_payload",
  "input_failed",
  "duplicate",
  "unknown",
]);
export type AckStatus = z.infer<typeof ackStatusSchema>;

export const textAckFrameSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal("text.ack"),
  messageId: z.uuid(),
  status: ackStatusSchema,
  detail: z.string().max(200).optional(),
});

export const devicePauseFrameSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal("device.pause"),
  paused: z.boolean(),
});

export const clientFrameSchema = z.discriminatedUnion("type", [
  authFrameSchema,
  heartbeatFrameSchema,
  textSendFrameSchema,
  textAckFrameSchema,
  devicePauseFrameSchema,
]);
export type ClientFrame = z.infer<typeof clientFrameSchema>;

export type ServerFrame =
  | { v: 1; type: "auth.ok"; connectionId: string; expiresAt: number }
  | { v: 1; type: "heartbeat"; at: number }
  | { v: 1; type: "presence.snapshot"; devices: DevicePresence[] }
  | { v: 1; type: "presence.changed"; device: DevicePresence }
  | { v: 1; type: "text.deliver"; messageId: string; sentAt: number; ciphertext: string }
  | { v: 1; type: "text.ack"; messageId: string; status: AckStatus; detail?: string }
  | { v: 1; type: "error"; code: string; message: string; messageId?: string };

export const serverFrameSchema = z.discriminatedUnion("type", [
  z.object({ v: z.literal(PROTOCOL_VERSION), type: z.literal("auth.ok"), connectionId: z.uuid(), expiresAt: z.number().int() }),
  z.object({ v: z.literal(PROTOCOL_VERSION), type: z.literal("heartbeat"), at: z.number().int() }),
  z.object({ v: z.literal(PROTOCOL_VERSION), type: z.literal("presence.snapshot"), devices: z.array(devicePresenceSchema) }),
  z.object({ v: z.literal(PROTOCOL_VERSION), type: z.literal("presence.changed"), device: devicePresenceSchema }),
  z.object({ v: z.literal(PROTOCOL_VERSION), type: z.literal("text.deliver"), messageId: z.uuid(), sentAt: z.number().int(), ciphertext: z.string().base64() }),
  z.object({ v: z.literal(PROTOCOL_VERSION), type: z.literal("text.ack"), messageId: z.uuid(), status: ackStatusSchema, detail: z.string().max(200).optional() }),
  z.object({ v: z.literal(PROTOCOL_VERSION), type: z.literal("error"), code: z.string(), message: z.string(), messageId: z.uuid().optional() }),
]);

export function parseServerFrame(value: unknown): ServerFrame {
  return serverFrameSchema.parse(value) as ServerFrame;
}

export const encryptedPayloadSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  messageId: z.uuid(),
  sentAt: z.number().int(),
  text: z.string().max(MAX_TEXT_CODE_UNITS),
  // Optional for backwards compatibility with messages created before the
  // auto-submit option existed. Missing means “paste only”.
  submitWithEnter: z.boolean().optional().default(false),
});
export type EncryptedPayload = z.infer<typeof encryptedPayloadSchema>;

export function countUtf16CodeUnits(text: string): number {
  return text.length;
}

export function parseClientFrame(value: unknown): ClientFrame {
  return clientFrameSchema.parse(value);
}

