import { afterEach, describe, expect, it } from 'bun:test';
import { unlink } from 'node:fs/promises';
import { withBenchmarkStaging } from './observability-staging';

const marker = `/tmp/monobungsia-staging-${crypto.randomUUID()}`;

afterEach(async () => {
  await unlink(marker).catch(() => undefined);
});

describe('benchmark staging lifecycle', () => {
  it('always destroys a candidate when the benchmark fails', async () => {
    await expect(
      withBenchmarkStaging(
        {
          createCommand: `touch ${marker}`,
          destroyCommand: `rm -f ${marker}`,
          stateFile: `${marker}.state`,
          targetUrl: 'http://127.0.0.1:1',
          requireTarget: true,
        },
        async () => {
          expect(await Bun.file(marker).exists()).toBe(true);
          throw new Error('synthetic benchmark failure');
        },
      ),
    ).rejects.toThrow('synthetic benchmark failure');
    expect(await Bun.file(marker).exists()).toBe(false);
  });

  it('rejects a required run without a complete staging contract', async () => {
    await expect(
      withBenchmarkStaging(
        { stateFile: `${marker}.state`, requireTarget: true },
        async () => undefined,
      ),
    ).rejects.toThrow('required benchmark staging');
  });
});
