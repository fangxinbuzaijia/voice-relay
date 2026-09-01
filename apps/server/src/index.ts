import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { ensureBootstrapAccount } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { createContentSecurityPolicy } from "./content-security.js";
import { AppDatabase } from "./database.js";
import { RelayHub } from "./relay-hub.js";
import { registerRoutes } from "./routes.js";
import { isAllowedBrowserOrigin, isPrivateOrLoopbackAddress } from "./request-security.js";

const config = loadConfig();
const db = new AppDatabase(config.DB_PATH);
const bootstrapCredentials = await ensureBootstrapAccount(db, config.dataDirectory);
const app = Fastify({
  logger: {
    level: config.NODE_ENV === "production" ? "info" : "debug",
    redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
  },
  trustProxy: (address) => isPrivateOrLoopbackAddress(address),
  bodyLimit: 80 * 1024,
});
const hub = new RelayHub(db);

await app.register(cookie);
await app.register(helmet, {
  contentSecurityPolicy: createContentSecurityPolicy(),
});
await app.register(websocket);

app.addHook("onRequest", async (request, reply) => {
  if (!isAllowedBrowserOrigin(request.headers.origin, request.headers.host, config.NODE_ENV === "production")) {
    return reply.code(403).send({ error: "invalid_origin" });
  }
});

app.get("/ws", { websocket: true }, (socket) => hub.attach(socket));
await registerRoutes(app, db, hub, config);

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = config.WEB_ROOT ?? path.resolve(currentDir, "../../web/dist");
await app.register(fastifyStatic, { root: webRoot, wildcard: false });
app.get("/*", async (request, reply) => {
  const url = request.url;
  if (url.startsWith("/api/") || url.startsWith("/ws") || url.startsWith("/health/")) {
    return reply.code(404).send({ error: "not_found" });
  }
  return reply.sendFile("index.html");
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "Shutting down");
  hub.close();
  await app.close();
  db.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

db.deleteExpiredSessions();
await app.listen({ host: config.HOST, port: config.PORT });
if (bootstrapCredentials) {
  app.log.warn({
    username: bootstrapCredentials.username,
    password: bootstrapCredentials.password,
    credentialsFile: bootstrapCredentials.file,
  }, "Initial account created. Change the username and password after signing in.");
}
