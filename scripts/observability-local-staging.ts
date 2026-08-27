import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';

interface LocalStagingState {
  pid: number;
  port: number;
  targetUrl: string;
  owner: string;
  service: 'fixture' | 'gateway';
  createdAt: string;
}

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

function statePath(): string {
  return (
    Bun.env.BENCHMARK_STAGING_STATE_FILE ??
    argument('state') ??
    '/tmp/monobungsia-observability-staging.json'
  );
}

function port(): number {
  const value = Number.parseInt(
    Bun.env.BENCHMARK_STAGING_PORT ?? argument('port') ?? '4314',
    10,
  );
  if (!Number.isInteger(value) || value < 1024 || value > 65_535) {
    throw new Error('BENCHMARK_STAGING_PORT must be between 1024 and 65535');
  }
  return value;
}

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError = 'health endpoint did not respond';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
      lastError = `health endpoint returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(50);
  }
  throw new Error(
    `local benchmark staging did not become healthy: ${lastError}`,
  );
}

async function create(): Promise<void> {
  const file = statePath();
  const stagingPort = port();
  const service =
    Bun.env.BENCHMARK_STAGING_SERVICE === 'gateway' ? 'gateway' : 'fixture';
  const targetUrl = `http://127.0.0.1:${stagingPort}`;
  await mkdir(file.slice(0, file.lastIndexOf('/')) || '.', { recursive: true });
  if (await Bun.file(file).exists()) {
    throw new Error(`local benchmark staging state already exists: ${file}`);
  }

  const command =
    service === 'gateway'
      ? ['bun', 'apps/gateway/erp/src/main.ts']
      : ['bun', 'run', 'scripts/observability-local-staging.ts', 'serve'];
  const child = Bun.spawn(command, {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...Bun.env,
      BENCHMARK_STAGING_PORT: String(stagingPort),
      ...(service === 'gateway'
        ? {
            ENABLE_INFRASTRUCTURE: 'false',
            // The disposable target is a local benchmark fixture, not a
            // production cutover. Explicitly pin the baseline mode so a
            // developer's ClickHouse promotion settings cannot prevent the
            // gateway from starting.
            NODE_ENV: 'test',
            OBSERVABILITY_SIGNAL_WRITE_MODE: 'postgres',
            OBSERVABILITY_SIGNAL_READ_MODE: 'postgres',
            PORT: String(stagingPort),
            SERVICE_INSTANCE_ID: `benchmark-staging-gateway-${process.pid}`,
            TELEMETRY_ENABLED: 'true',
          }
        : {}),
    },
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  });
  child.unref();
  const state: LocalStagingState = {
    pid: child.pid,
    port: stagingPort,
    targetUrl,
    owner:
      Bun.env.BENCHMARK_STAGING_OWNER ??
      `local-benchmark-staging:${process.pid}`,
    service,
    createdAt: new Date().toISOString(),
  };
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(file, 0o600);
  try {
    await waitForHealth(targetUrl);
  } catch (error) {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      // The child may have exited while health was being checked.
    }
    await unlink(file).catch(() => undefined);
    throw error;
  }
  console.log(JSON.stringify(state));
}

async function destroy(): Promise<void> {
  const file = statePath();
  if (!(await Bun.file(file).exists())) return;
  const state = JSON.parse(await readFile(file, 'utf8')) as LocalStagingState;
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(state.pid, 0);
    } catch {
      await unlink(file);
      console.log(JSON.stringify({ destroyed: true, ...state }));
      return;
    }
    await Bun.sleep(50);
  }
  try {
    process.kill(state.pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  await unlink(file);
  console.log(JSON.stringify({ destroyed: true, forced: true, ...state }));
}

async function serve(): Promise<void> {
  const server = Bun.serve({
    port: port(),
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/health') {
        return Response.json({ status: 'ok', service: 'benchmark-staging' });
      }
      if (request.method === 'GET') {
        return Response.json({
          status: 'ok',
          service: 'benchmark-staging',
          route: pathname,
        });
      }
      return new Response('method not allowed', { status: 405 });
    },
  });
  console.log(`local benchmark staging listening on ${server.url}`);
  await new Promise<void>((resolve) => {
    const stop = () => {
      server.stop();
      resolve();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  });
}

const command = Bun.argv[2];
if (command === 'create') await create();
else if (command === 'destroy') await destroy();
else if (command === 'serve') await serve();
else throw new Error('expected create, destroy, or serve');
