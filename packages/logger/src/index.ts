export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

const SENSITIVE_QUERY_KEYS = new Set(["token", "session", "code", "secret"]);

export function redactRequestUrl(value: string): string {
  try {
    const url = new URL(value);

    for (const key of SENSITIVE_QUERY_KEYS) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }

    return url.toString();
  } catch {
    return "[REDACTED_URL]";
  }
}

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  constructor(
    private readonly serviceName: string,
    private readonly minimumLevel: LogLevel = "info",
  ) {}

  debug(message: string, context: LogContext = {}): void {
    this.write("debug", message, context);
  }

  info(message: string, context: LogContext = {}): void {
    this.write("info", message, context);
  }

  warn(message: string, context: LogContext = {}): void {
    this.write("warn", message, context);
  }

  error(message: string, context: LogContext = {}): void {
    this.write("error", message, context);
  }

  private write(level: LogLevel, message: string, context: LogContext): void {
    if (levelRank[level] < levelRank[this.minimumLevel]) {
      return;
    }

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: this.serviceName,
        message,
        ...context,
      }),
    );
  }
}
