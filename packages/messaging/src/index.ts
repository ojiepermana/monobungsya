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
