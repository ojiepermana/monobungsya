import {
  connect,
  headers,
  JSONCodec,
  type Msg,
  type NatsConnection,
  type Subscription,
} from 'nats';
import type { Telemetry } from '#project/telemetry';

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
  telemetry?: Telemetry,
): Promise<NatsMessaging> {
  const connection = await connect({ servers: url, name: serviceName });
  return new NatsMessaging(connection, telemetry);
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
  telemetry?: Telemetry,
): Promise<NatsMessaging | undefined> {
  try {
    return await connectMessaging(url, serviceName, telemetry);
  } catch (error) {
    onUnavailable?.(error);

    return undefined;
  }
}

export class NatsMessaging implements Publisher, Subscriber, Requester {
  private readonly codec = JSONCodec<unknown>();

  constructor(
    private readonly connection: NatsConnection,
    private readonly telemetry?: Telemetry,
  ) {}

  publish<T>(subject: string, payload: T): void {
    const publish = () => {
      const messageHeaders = headers();
      const context = this.telemetry?.currentContext();
      if (context) {
        messageHeaders.set(
          'traceparent',
          this.telemetry?.inject(context).traceparent ?? '',
        );
        if (context.correlationId) {
          messageHeaders.set('x-correlation-id', context.correlationId);
        }
      }
      this.connection.publish(subject, this.codec.encode(payload), {
        headers: messageHeaders,
      });
    };
    if (!this.telemetry) publish();
    else {
      this.telemetry.withSpan(
        {
          resourceKind: 'nats.publish',
          resourceName: stableSubject(subject),
          operation: 'publish',
        },
        publish,
      );
    }
  }

  subscribe<T>(
    subject: string,
    handler: (payload: T, message: Msg) => Promise<void> | void,
  ): Subscription {
    const subscription = this.connection.subscribe(subject);

    void (async () => {
      for await (const message of subscription) {
        const context = this.telemetry?.extract({
          traceparent: message.headers?.get('traceparent'),
          correlationId: message.headers?.get('x-correlation-id'),
        });
        const consume = () =>
          handler(this.codec.decode(message.data) as T, message);
        if (!this.telemetry || !context) await consume();
        else {
          await this.telemetry.withContext(context, () =>
            this.telemetry?.withSpan(
              {
                resourceKind: 'nats.consume',
                resourceName: stableSubject(subject),
                operation: 'consume',
              },
              consume,
            ),
          );
        }
      }
    })();

    return subscription;
  }

  async request<TRequest, TResponse>(
    subject: string,
    payload: TRequest,
    timeoutMs = 2_000,
  ): Promise<TResponse> {
    const request = async () => {
      const messageHeaders = headers();
      const context = this.telemetry?.currentContext();
      if (context) {
        messageHeaders.set(
          'traceparent',
          this.telemetry?.inject(context).traceparent ?? '',
        );
        if (context.correlationId) {
          messageHeaders.set('x-correlation-id', context.correlationId);
        }
      }
      const response = await this.connection.request(
        subject,
        this.codec.encode(payload),
        { timeout: timeoutMs, headers: messageHeaders },
      );
      return this.codec.decode(response.data) as TResponse;
    };
    if (!this.telemetry) return request();
    return this.telemetry.withSpan(
      {
        resourceKind: 'nats.request',
        resourceName: stableSubject(subject),
        operation: 'request',
      },
      request,
    );
  }

  async close(): Promise<void> {
    await this.connection.drain();
  }
}

function stableSubject(subject: string): string {
  return subject.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 150) || 'unknown';
}
