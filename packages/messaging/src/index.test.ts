import { describe, expect, it } from 'bun:test';
import { tryConnectMessaging } from './index';

/**
 * Spec docs/specs/0007-user-management, AC-2: a service whose events are fire
 * and forget must keep serving requests when NATS is down. `connectMessaging`
 * throws (used where events are load bearing); `tryConnectMessaging` is the
 * wrapper composition roots use instead so a missing broker degrades the
 * service rather than crashing it at startup.
 */
describe('tryConnectMessaging', () => {
  it('resolves to undefined and reports the error when the broker refuses the connection', async () => {
    // Nothing listens on a low numbered port like this; the OS returns
    // connection refused immediately, so this needs no test infrastructure.
    const reported: unknown[] = [];

    const result = await tryConnectMessaging(
      'nats://127.0.0.1:1',
      'test-service',
      (error) => {
        reported.push(error);
      },
    );

    expect(result).toBeUndefined();
    expect(reported).toHaveLength(1);
  });

  it('does not throw when no onUnavailable callback is given', async () => {
    await expect(
      tryConnectMessaging('nats://127.0.0.1:1', 'test-service'),
    ).resolves.toBeUndefined();
  });

  it('resolves to a working NatsMessaging when the broker is reachable', async () => {
    const url = Bun.env.NATS_URL;

    if (!url) {
      // No local broker configured for this run; the failure path above
      // already proves the degrade-instead-of-throw contract.
      return;
    }

    const onUnavailable = () => {
      throw new Error('should not report a reachable broker as unavailable');
    };
    const connection = await tryConnectMessaging(
      url,
      'test-service',
      onUnavailable,
    );

    expect(connection).toBeDefined();
    expect(typeof connection?.publish).toBe('function');

    await connection?.close();
  });
});
