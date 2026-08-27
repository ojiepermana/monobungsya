import nodemailer, { type Transporter } from 'nodemailer';
import type { DatabaseClient } from '#project/database';
import { ConflictError, NotFoundError } from '#project/errors';
import type {
  JobFailureNotificationPayload,
  NotificationCreatePayload,
  NotificationEmailDeliveryPayload,
  NotificationRecipientCapabilitySyncPayload,
  NotificationRecipientSyncPayload,
} from '#project/jobs';

export const NOTIFICATION_CATEGORIES = [
  'security',
  'access',
  'account',
  'operational',
] as const;
export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;
const NOTIFICATIONS_PER_PAGE = 100;
type Category = (typeof NOTIFICATION_CATEGORIES)[number];
type Channel = (typeof NOTIFICATION_CHANNELS)[number];

type Definition = {
  category: Category;
  severity: 'info' | 'warning' | 'critical';
  templateKey: string;
  templateVersion: number;
  defaultChannels: readonly Channel[];
  mandatoryChannels: readonly Channel[];
  render: (payload: Record<string, unknown>) => {
    title: string;
    body: string;
    metadata: Record<string, unknown>;
    actionRoute: string | null;
  };
};

const definitions: Record<string, Definition> = {
  'security.sign_in': {
    category: 'security',
    severity: 'info',
    templateKey: 'security.sign_in',
    templateVersion: 1,
    defaultChannels: ['in_app', 'email'],
    mandatoryChannels: ['in_app'],
    render: (payload) => ({
      title: 'Aktivitas keamanan baru',
      body: `Login berhasil melalui ${safe(payload.authMethod, 'metode keamanan')}, ${safe(payload.browser, 'peramban')} pada ${safe(payload.platform, 'perangkat')}.`,
      metadata: pick(payload, [
        'authMethod',
        'browser',
        'platform',
        'maskedIp',
      ]),
      actionRoute: '/setting/passkeys',
    }),
  },
  'security.passkey_changed': {
    category: 'security',
    severity: 'info',
    templateKey: 'security.passkey_changed',
    templateVersion: 1,
    defaultChannels: ['in_app', 'email'],
    mandatoryChannels: ['in_app'],
    render: (payload) => ({
      title: 'Passkey diperbarui',
      body: `Passkey Anda ${safe(payload.action, 'diperbarui')} melalui ${safe(payload.browser, 'peramban')} pada ${safe(payload.platform, 'perangkat')}.`,
      metadata: pick(payload, [
        'action',
        'authMethod',
        'browser',
        'platform',
        'maskedIp',
      ]),
      actionRoute: '/setting/passkeys',
    }),
  },
  'security.totp_changed': {
    category: 'security',
    severity: 'info',
    templateKey: 'security.totp_changed',
    templateVersion: 1,
    defaultChannels: ['in_app', 'email'],
    mandatoryChannels: ['in_app'],
    render: (payload) => ({
      title: 'Verifikasi dua langkah diperbarui',
      body: `Verifikasi dua langkah Anda ${safe(payload.action, 'diperbarui')} melalui ${safe(payload.browser, 'peramban')} pada ${safe(payload.platform, 'perangkat')}.`,
      metadata: pick(payload, [
        'action',
        'authMethod',
        'browser',
        'platform',
        'maskedIp',
      ]),
      actionRoute: '/auth/two-factor',
    }),
  },
  'security.session_revoked': {
    category: 'security',
    severity: 'warning',
    templateKey: 'security.session_revoked',
    templateVersion: 1,
    defaultChannels: ['in_app', 'email'],
    mandatoryChannels: ['in_app'],
    render: (payload) => ({
      title: 'Sesi dicabut',
      body: `Sesi akun Anda dicabut melalui ${safe(payload.browser, 'peramban')} pada ${safe(payload.platform, 'perangkat')}.`,
      metadata: pick(payload, [
        'authMethod',
        'browser',
        'platform',
        'maskedIp',
      ]),
      actionRoute: null,
    }),
  },
  'access.permission_changed': {
    category: 'access',
    severity: 'warning',
    templateKey: 'access.permission_changed',
    templateVersion: 1,
    defaultChannels: ['in_app', 'email'],
    mandatoryChannels: ['in_app'],
    render: (payload) => ({
      title: 'Perubahan akses',
      body: `Akses Anda telah ${safe(payload.action, 'diperbarui')}: ${safe(payload.permissionName, 'izin')}.`,
      metadata: pick(payload, ['action', 'permissionName', 'summary']),
      actionRoute: '/access/permissions',
    }),
  },
  'account.status_changed': {
    category: 'account',
    severity: 'warning',
    templateKey: 'account.status_changed',
    templateVersion: 1,
    defaultChannels: ['in_app', 'email'],
    mandatoryChannels: ['in_app', 'email'],
    render: (payload) => ({
      title: 'Status akun berubah',
      body: `Status akun Anda sekarang ${safe(payload.status, 'diperbarui')}.`,
      metadata: pick(payload, ['action', 'status']),
      actionRoute: '/users',
    }),
  },
  'operational.job_failed': {
    category: 'operational',
    severity: 'critical',
    templateKey: 'operational.job_failed',
    templateVersion: 1,
    defaultChannels: ['in_app', 'email'],
    mandatoryChannels: [],
    render: (payload) => ({
      title: 'Pekerjaan otomatis gagal',
      body: `Pekerjaan ${safe(payload.jobType, 'otomatis')} gagal setelah ${safe(payload.attemptCount, 'beberapa')} percobaan.`,
      metadata: pick(payload, ['jobType', 'attemptCount', 'status']),
      actionRoute: '/operations/jobs',
    }),
  },
};

export interface NotificationMailer {
  send(input: {
    recipient: string;
    title: string;
    body: string;
  }): Promise<string | null>;
}

export class SmtpNotificationMailer implements NotificationMailer {
  private readonly transporter: Transporter;
  constructor(
    private readonly config: {
      host: string;
      port: number;
      username: string;
      password: string;
      from: string;
    },
  ) {
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
  async send(input: {
    recipient: string;
    title: string;
    body: string;
  }): Promise<string | null> {
    const result = await this.transporter.sendMail({
      from: this.config.from,
      to: input.recipient,
      subject: input.title,
      text: input.body,
    });
    return result.messageId ?? null;
  }
}

export class NotificationService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly mailer?: NotificationMailer,
  ) {}

  async syncRecipient(input: NotificationRecipientSyncPayload): Promise<void> {
    await this.database`
      INSERT INTO notification.recipient_projection (user_id, display_name, email, active, can_read_jobs, synced_at)
      VALUES (${input.userId}, ${input.displayName}, ${input.email}, ${input.active}, ${input.canReadJobs ?? false}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      ON CONFLICT (user_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        email = EXCLUDED.email,
        active = EXCLUDED.active,
        can_read_jobs = EXCLUDED.can_read_jobs,
        synced_at = EXCLUDED.synced_at
    `;
  }

  async syncRecipientCapability(
    input: NotificationRecipientCapabilitySyncPayload,
  ): Promise<void> {
    await this.database`
      UPDATE notification.recipient_projection
      SET can_read_jobs = ${input.canReadJobs}, synced_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
      WHERE user_id = ${input.userId}
    `;
  }

  async create(input: NotificationCreatePayload) {
    const definition = definitions[input.type];
    if (!definition || input.version !== 1)
      throw new Error('unknown notification type or version');
    const [recipient] = await this.database`
      SELECT user_id, email, active FROM notification.recipient_projection WHERE user_id = ${input.userId}
    `;
    if (!recipient || (!recipient.active && definition.category !== 'account'))
      return null;
    const rendered = definition.render(input.payload);
    const idempotencyKey =
      input.eventKey ??
      `notification:${input.type}:${input.userId}:${input.occurredAt}`;
    const [row] = await this.database`
      INSERT INTO notification.notification (
        user_id, idempotency_key, category, severity, type, template_key, template_version,
        title, body, metadata, action_route
      ) VALUES (
        ${input.userId}, ${idempotencyKey}, ${definition.category}, ${definition.severity}, ${input.type},
        ${definition.templateKey}, ${definition.templateVersion}, ${rendered.title},
        ${rendered.body}, ${rendered.metadata}::jsonb, ${rendered.actionRoute}
      ) ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING id, user_id, category, severity, type, title, body, metadata,
        action_route, read_at::text AS read_at, created_at::text AS created_at
    `;
    if (!row) return null;
    for (const channel of definition.defaultChannels) {
      const enabled =
        definition.mandatoryChannels.includes(channel) ||
        (await this.effectivePreference(
          input.userId,
          definition.category,
          channel,
        ));
      const status = enabled ? 'queued' : 'skipped';
      const [delivery] = await this.database`
        INSERT INTO notification.notification_delivery (
          notification_id, channel, status, recipient_email, skipped_at
        ) VALUES (
          ${row.id}, ${channel}, ${status}, ${channel === 'email' ? String(recipient.email) : null},
          ${status === 'skipped' ? new Date() : null}
        ) ON CONFLICT (notification_id, channel) DO NOTHING
        RETURNING id
      `;
      if (channel === 'email' && status === 'queued' && delivery?.id) {
        const jobId = await this.enqueueEmail(
          String(delivery.id),
          input.correlationId ?? null,
        );
        if (jobId) {
          await this
            .database`UPDATE notification.notification_delivery SET job_id = ${jobId} WHERE id = ${delivery.id}`;
        }
      }
    }
    return mapNotification(row);
  }

  async fanoutJobFailure(input: JobFailureNotificationPayload): Promise<void> {
    const recipients = await this.database`
      SELECT user_id
      FROM notification.recipient_projection
      WHERE active = true AND can_read_jobs = true
    `;
    for (const recipient of recipients as Array<{ user_id: string }>) {
      await this.create({
        userId: String(recipient.user_id),
        type: 'operational.job_failed',
        version: 1,
        payload: {
          jobType: input.jobType,
          attemptCount: input.attemptCount,
          status: 'failed',
        },
        occurredAt: input.failedAt,
        eventKey: `job-failure:${input.jobId}:${recipient.user_id}`,
      });
    }
  }

  async list(
    userId: string,
    query: {
      page?: string;
      pageSize?: string;
      category?: string;
      unreadOnly?: string;
    },
  ) {
    const page = positivePage(query.page);
    const pageSize = positivePageSize(query.pageSize);
    const category =
      query.category &&
      NOTIFICATION_CATEGORIES.includes(query.category as Category)
        ? query.category
        : '';
    const unreadOnly = query.unreadOnly === 'true';
    const params: unknown[] = [userId];
    const conditions = ['user_id = $1'];
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (unreadOnly) conditions.push('read_at IS NULL');
    const where = conditions.join(' AND ');
    const countRows = await this.database.unsafe(
      `SELECT count(*)::integer AS total FROM notification.notification WHERE ${where}`,
      params as never[],
    );
    const rows = await this.database.unsafe(
      `SELECT id, category, severity, type, title, body, metadata, action_route, read_at::text AS read_at, created_at::text AS created_at FROM notification.notification WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize] as never[],
    );
    const total = Number(
      (countRows as Array<{ total: number }>)[0]?.total ?? 0,
    );
    return {
      data: rows.map(mapNotification),
      meta: {
        page,
        perPage: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      filters: { page, category, unreadOnly },
      options: { categories: [...NOTIFICATION_CATEGORIES] },
    };
  }

  async unreadCount(userId: string) {
    const rows = await this
      .database`SELECT category, count(*)::integer AS count FROM notification.notification WHERE user_id = ${userId} AND read_at IS NULL GROUP BY category`;
    const categories = Object.fromEntries(
      NOTIFICATION_CATEGORIES.map((category) => [category, 0]),
    );
    for (const row of rows as Array<{ category: string; count: number }>)
      categories[row.category] = Number(row.count);
    return {
      total: Object.values(categories).reduce((sum, count) => sum + count, 0),
      categories,
    };
  }

  async markRead(userId: string, id: string) {
    const [row] = await this.database`
      UPDATE notification.notification SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, category, severity, type, title, body, metadata, action_route, read_at::text AS read_at, created_at::text AS created_at
    `;
    if (!row) throw new NotFoundError('Notification not found');
    return mapNotification(row);
  }

  async markAllRead(userId: string) {
    const result = await this
      .database`UPDATE notification.notification SET read_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' WHERE user_id = ${userId} AND read_at IS NULL`;
    return { changed: result.count };
  }

  async preferences(userId: string) {
    const rows = await this
      .database`SELECT category, channel, enabled FROM notification.notification_preference WHERE user_id = ${userId}`;
    return {
      categories: NOTIFICATION_CATEGORIES.map((category) => ({
        category,
        channels: NOTIFICATION_CHANNELS.map((channel) => ({
          channel,
          enabled: effectiveFromRows(rows, userId, category, channel),
          mandatory: isMandatory(category, channel),
        })),
      })),
    };
  }

  async updatePreference(
    userId: string,
    category: string,
    channel: Channel,
    enabled: boolean,
  ) {
    if (!NOTIFICATION_CATEGORIES.includes(category as Category))
      throw new NotFoundError('Notification category not found');
    const mandatory = isMandatory(category as Category, channel);
    if (mandatory && !enabled)
      throw new ConflictError(
        'This notification preference is mandatory',
        'mandatory_preference',
      );
    await this.database`
      INSERT INTO notification.notification_preference (user_id, category, channel, enabled)
      VALUES (${userId}, ${category}, ${channel}, ${enabled})
      ON CONFLICT (user_id, category, channel) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
    `;
    return { category, channel, enabled, mandatory };
  }

  async sendEmail(input: NotificationEmailDeliveryPayload): Promise<void> {
    const [delivery] = await this.database`
      SELECT delivery.id, delivery.status, delivery.recipient_email, notification.title, notification.body
      FROM notification.notification_delivery AS delivery
      JOIN notification.notification AS notification ON notification.id = delivery.notification_id
      WHERE delivery.id = ${input.notificationDeliveryId} AND delivery.channel = 'email'
    `;
    if (!delivery || ['sent', 'skipped'].includes(String(delivery.status)))
      return;
    if (!this.mailer || !delivery.recipient_email) {
      await this
        .database`UPDATE notification.notification_delivery SET status = 'failed', failed_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC', error_code = 'mailer_unavailable', error_message = 'notification mailer is not configured' WHERE id = ${input.notificationDeliveryId}`;
      throw new Error('notification mailer is not configured');
    }
    await this
      .database`UPDATE notification.notification_delivery SET status = 'processing' WHERE id = ${input.notificationDeliveryId} AND status = 'queued'`;
    try {
      const messageId = await this.mailer.send({
        recipient: String(delivery.recipient_email),
        title: String(delivery.title),
        body: String(delivery.body),
      });
      await this
        .database`UPDATE notification.notification_delivery SET status = 'sent', sent_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC', provider_message_id = ${messageId} WHERE id = ${input.notificationDeliveryId}`;
    } catch (error) {
      await this
        .database`UPDATE notification.notification_delivery SET status = 'failed', failed_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC', error_code = 'provider_error', error_message = ${error instanceof Error ? error.message.slice(0, 1000) : 'provider error'} WHERE id = ${input.notificationDeliveryId}`;
      throw error;
    }
  }

  async cleanup(before: Date) {
    const result = await this
      .database`DELETE FROM notification.notification WHERE created_at < ${before} RETURNING id`;
    return Number(result.count);
  }

  private async effectivePreference(
    userId: string,
    category: Category,
    channel: Channel,
  ) {
    if (isMandatory(category, channel)) return true;
    const [row] = await this
      .database`SELECT enabled FROM notification.notification_preference WHERE user_id = ${userId} AND category = ${category} AND channel = ${channel}`;
    return row ? Boolean(row.enabled) : true;
  }

  private async enqueueEmail(deliveryId: string, correlationId: string | null) {
    const payload = { notificationDeliveryId: deliveryId };
    const [row] = await this.database`
      SELECT * FROM jobs.enqueue_job(
        'notification.email_delivery', 1,
        ${payload}::jsonb,
        'notification', 'notification', ${`notification-email:${deliveryId}`},
        ${correlationId}, NULL, 0,
        CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 5, NULL, NULL
      )
    `;
    return row?.id ? String(row.id) : null;
  }
}

function isMandatory(category: Category, channel: Channel): boolean {
  return (
    ((category === 'security' || category === 'access') &&
      channel === 'in_app') ||
    (category === 'account' && channel === 'email')
  );
}

function effectiveFromRows(
  rows: unknown[],
  _userId: string,
  category: Category,
  channel: Channel,
): boolean {
  if (isMandatory(category, channel)) return true;
  const row = rows.find((candidate) => {
    const value = candidate as { category?: string; channel?: string };
    return value.category === category && value.channel === channel;
  }) as { enabled?: boolean } | undefined;
  return row?.enabled ?? true;
}

function mapNotification(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    category: String(row.category),
    severity: String(row.severity),
    type: String(row.type),
    title: String(row.title),
    body: String(row.body),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    actionRoute: row.action_route ? String(row.action_route) : null,
    readAt: row.read_at ? String(row.read_at) : null,
    createdAt: String(row.created_at),
  };
}

function positivePage(value: string | undefined): number {
  const parsed = Number(value ?? '1');
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function positivePageSize(value: string | undefined): number {
  const parsed = Number(value ?? NOTIFICATIONS_PER_PAGE);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, NOTIFICATIONS_PER_PAGE)
    : NOTIFICATIONS_PER_PAGE;
}

function safe(value: unknown, fallback: string): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}

function pick(
  payload: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(payload, key))
      .map((key) => [key, payload[key]]),
  );
}
