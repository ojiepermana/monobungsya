import nodemailer, { type Transporter } from "nodemailer";
import type { AuthMailer, MagicLinkMessage } from "./auth.types";

export interface SmtpMailerConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  publicApiUrl: string;
  webAppUrl: string;
}

export class SmtpAuthMailer implements AuthMailer {
  private readonly transporter: Transporter;

  constructor(private readonly config: SmtpMailerConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth:
        config.username && config.password
          ? { user: config.username, pass: config.password }
          : undefined,
    });
  }

  async sendMagicLink(message: MagicLinkMessage): Promise<void> {
    const verifyUrl = new URL("/api/v1/auth/verify", this.config.publicApiUrl);
    verifyUrl.searchParams.set("token", message.token);

    await this.transporter.sendMail({
      from: this.config.from,
      to: message.recipient,
      subject: "Your Monobungsia sign in link",
      text: `Hello ${message.recipientName},\n\nSign in with this link: ${verifyUrl}\n\nThis link expires at ${message.expiresAt.toISOString()} and can only be used once.`,
    });
  }
}

export class NoopAuthMailer implements AuthMailer {
  async sendMagicLink(_message: MagicLinkMessage): Promise<void> {
    return Promise.resolve();
  }
}
