import { afterEach, describe, expect, it } from 'bun:test';
import { unlink } from 'node:fs/promises';

const stateFile = `/tmp/monobungsia-local-staging-${crypto.randomUUID()}.json`;
const port = 43_000 + Math.floor(Math.random() * 1_000);

async function run(
  command: 'create' | 'destroy',
  service: 'fixture' | 'gateway' = 'fixture',
) {
  const child = Bun.spawn(
    ['bun', 'run', 'scripts/observability-local-staging.ts', command],
    {
      cwd: process.cwd(),
      env: {
        ...Bun.env,
        BENCHMARK_STAGING_STATE_FILE: stateFile,
        BENCHMARK_STAGING_PORT: String(port),
        BENCHMARK_STAGING_SERVICE: service,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const exitCode = await child.exited;
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  if (exitCode !== 0) throw new Error(stderr || stdout);
  return JSON.parse(stdout.trim()) as {
    targetUrl?: string;
    destroyed?: boolean;
  };
}

afterEach(async () => {
  if (await Bun.file(stateFile).exists()) await run('destroy');
  await unlink(stateFile).catch(() => undefined);
});

describe('local observability staging lifecycle', () => {
  it('creates an isolated target and destroys it by recorded ownership', async () => {
    const created = await run('create');
    expect(created.targetUrl).toBe(`http://127.0.0.1:${port}`);
    expect(await (await fetch(`${created.targetUrl}/health`)).json()).toEqual({
      status: 'ok',
      service: 'benchmark-staging',
    });

    const destroyed = await run('destroy');
    expect(destroyed.destroyed).toBe(true);
    expect(await Bun.file(stateFile).exists()).toBe(false);
  });

  it('can manage the real Bun gateway as an isolated target', async () => {
    const created = await run('create', 'gateway');
    expect(created.targetUrl).toBe(`http://127.0.0.1:${port}`);
    expect(await (await fetch(`${created.targetUrl}/health`)).json()).toEqual({
      status: 'ok',
      service: 'api-gateway',
    });

    const destroyed = await run('destroy', 'gateway');
    expect(destroyed.destroyed).toBe(true);
    expect(await Bun.file(stateFile).exists()).toBe(false);
  });
});
