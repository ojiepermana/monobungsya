import {
  connect,
  JSONCodec,
  type Msg,
  type NatsConnection,
  type Subscription,
} from 'nats';

export interface Publisher {
  publish<T>(subject: string, payload: T): void;
}

export interface Subscriber {
  subscribe<T>(
    subject: string,
    handler: (payload: T, message: Msg) => Promise<void> | void,
  ): Subscription;
}

export interface Requester {
  request<TRequest, TResponse>(
    subject: string,
    payload: TRequest,
    timeoutMs?: number,
  ): Promise<TResponse>;
}

export async function connectMessaging(
  url: string,
  serviceName: string,
): Promise<NatsMessaging> {
  const connection = await connect({ servers: url, name: serviceName });
  return new NatsMessaging(connection);
}

/**
 * Connects, or returns undefined when the broker cannot be reached.
 *
 * `connectMessaging` throws, which takes a composition root down with it at
 * startup. A service whose events are fire and forget must keep serving
 * requests when NATS is down: spec docs/specs/0007-user-management (AC-2)
 * requires a user create to still succeed, with the skipped invitation logged
 * as a warning. Use this wherever a missing broker degrades the service instead
 * of stopping it, and keep `connectMessaging` for the case where events are
 * load bearing enough that the service should refuse to start without them.
 */
export async function tryConnectMessaging(
  url: string,
  serviceName: string,
  onUnavailable?: (error: unknown) => void,
): Promise<NatsMessaging | undefined> {
  try {
    return await connectMessaging(url, serviceName);
  } catch (error) {
    onUnavailable?.(error);

    return undefined;
  }
}

export class NatsMessaging implements Publisher, Subscriber, Requester {
  private readonly codec = JSONCodec<unknown>();

  constructor(private readonly connection: NatsConnection) {}

  publish<T>(subject: string, payload: T): void {
    this.connection.publish(subject, this.codec.encode(payload));
  }

  subscribe<T>(
    subject: string,
    handler: (payload: T, message: Msg) => Promise<void> | void,
  ): Subscription {
    const subscription = this.connection.subscribe(subject);

    void (async () => {
      for await (const message of subscription) {
        await handler(this.codec.decode(message.data) as T, message);
      }
    })();

    return subscription;
  }

  async request<TRequest, TResponse>(
    subject: string,
    payload: TRequest,
    timeoutMs = 2_000,
  ): Promise<TResponse> {
    const response = await this.connection.request(
      subject,
      this.codec.encode(payload),
      {
        timeout: timeoutMs,
      },
    );

    return this.codec.decode(response.data) as TResponse;
  }

  async close(): Promise<void> {
    await this.connection.drain();
  }
}
