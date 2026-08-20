import { createApp } from "./app";
import { env } from "./config/env";

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
}

process.on("SIGINT", () => void shutdown("SIGINT").then(() => process.exit(0)));
process.on(
  "SIGTERM",
  () => void shutdown("SIGTERM").then(() => process.exit(0)),
);
