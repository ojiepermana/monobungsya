import { closeDatabaseClient } from "#project/database";
import { connectMessaging } from "#project/messaging";
import { createApp } from "./app";
import { env } from "./config/env";
import { createServiceDatabase } from "./database/client";

const database = env.ENABLE_INFRASTRUCTURE
  ? createServiceDatabase(env)
  : undefined;
const messaging = env.ENABLE_INFRASTRUCTURE
  ? await connectMessaging(env.NATS_URL, env.serviceName)
  : undefined;
const app = createApp(env);
const server = app.listen(env.PORT);

console.log(
  `${env.serviceName} listening on http://localhost:${server.server?.port ?? env.PORT}`,
);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${env.serviceName} received ${signal}, shutting down`);
  await server.stop();
  await messaging?.close();
  if (database) await closeDatabaseClient(database);
}

process.on("SIGINT", () => void shutdown("SIGINT").then(() => process.exit(0)));
process.on(
  "SIGTERM",
  () => void shutdown("SIGTERM").then(() => process.exit(0)),
);
