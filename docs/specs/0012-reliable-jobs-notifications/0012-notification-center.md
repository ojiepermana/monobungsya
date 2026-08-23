# 0012. Notification center

**Date**: 2026-08-23

**Status**: Proposed

**Parent**: [Reliable background jobs and notification center](./index.md)

## Responsibility

Provide reliable in app and email notifications for supported security, access, account, and operational events. This child spec owns the `notification` schema, notification service, recipient projection, templates, user preferences, Angular notification surfaces, and email delivery handlers.

## Notification registry

Every notification type must declare:

1. Stable type and payload version.
2. Runtime payload schema.
3. Category and severity.
4. Indonesian template key and version.
5. Default channels.
6. Mandatory channel rules.
7. Metadata and action route allowlists.
8. Redaction policy.
9. Required tests.

Unknown types are rejected before enqueue. Templates render immutable title and body snapshots at notification creation time.

## Data model

### `notification.recipient_projection`

1. `userId` primary key as a logical reference.
2. Display name and email.
3. Active state.
4. Boolean capability for `jobs:job:read`.
5. `syncedAt` timestamp.

An initial controlled migration role reads user and access data for backfill. Runtime notification roles cannot read those schemas. User and access services maintain the projection with durable jobs.

### `notification.notification`

1. UUIDv7 primary key and logical `userId`.
2. Category and severity.
3. Immutable rendered title and body.
4. Template key and template version.
5. Allowlisted metadata JSONB.
6. Normalized internal action route.
7. Nullable `readAt`.
8. Created timestamp in UTC.

A user has many notifications. A notification has many channel deliveries.

### `notification.notification_delivery`

1. UUIDv7 primary key and notification foreign key.
2. Channel and status.
3. Logical `jobId` reference.
4. Nullable provider message identifier.
5. Recipient email snapshot.
6. Queued, sent, skipped, and failed timestamps.
7. Sanitized error code and message.
8. Unique notification and channel pair.

Delivery states are `queued`, `processing`, `sent`, `skipped`, and `failed`.

### `notification.notification_preference`

1. UUIDv7 primary key and logical `userId`.
2. Category, channel, and enabled value.
3. Created and updated timestamps.
4. Unique user, category, and channel tuple.

Registry defaults and mandatory rules combine with stored overrides to produce the effective preference.

## Event sources

### Security activity

Create an in app security notification for every successful sign in, passkey add, rename, or delete, TOTP enable, disable, or reset, recovery code use, and all session revocation. Store event time, normalized auth method, normalized browser and platform, and masked IP only. Do not store raw user agent, token, cookie, secret, or credential.

New device detection is deferred to the future session security center.

### Access changes

After a grant, revoke, or permission copy transaction commits, the access service enqueues a notification for the target user. Payload contains a concise summary and never the complete sensitive permission set.

### Account status

After suspend, unsuspend, block, unblock, delete, or restore commits, the user service enqueues a notification for the target user. Account status is the only registry category allowed to finish delivery to an inactive recipient already being processed.

### Terminal job failure

A terminal eligible job fans out to every active recipient projected with `jobs:job:read`. It creates one notification per user. Jobs in the notification creation, notification email delivery, recipient projection, and failure fanout pipelines are never eligible for terminal failure notification. Their failure remains visible in jobs operations, logs, and metrics.

## Delivery flow

1. A source service transactionally enqueues `notification.create` with the recipient and registered event data.
2. The notification worker validates recipient state, renders the Indonesian template, normalizes the internal action route, and inserts the notification plus unique channel delivery rows.
3. In app delivery becomes available when the notification commits.
4. Email delivery enqueues a separate job containing `notificationDeliveryId` only.
5. The email handler loads the delivery, projection, and effective preference again immediately before sending through Nodemailer and SMTP.
6. Inactive or disabled recipients become `skipped`. Provider failures retry under the job policy and become `failed` when attempts are exhausted.
7. In app success is never rolled back because email fails.

SMTP cannot guarantee exactly once delivery. A timeout after provider acceptance can lead to a duplicate email on retry.

## User API

All routes derive `userId` from signed session identity. A body or query supplied `userId` is never accepted. Users do not need ACL permissions for their own notifications.

### `GET /api/v1/notifications`

Supports `page`, `category`, and `unreadOnly`. Page size is fixed at 25. Returns notification rows, pagination metadata, applied filters, and category options. Newest notifications appear first.

### `GET /api/v1/notifications/unread-count`

Returns total unread and category counts.

### `PATCH /api/v1/notifications/:id/read`

Idempotently sets server time as `readAt` and returns the notification. An identifier owned by another user returns `404`.

### `POST /api/v1/notifications/read-all`

Accepts no body and returns the number of changed rows.

### `GET /api/v1/notifications/preferences`

Returns registry categories, channel defaults, stored overrides, effective values, and mandatory flags.

### `PATCH /api/v1/notifications/preferences/:category/:channel`

Accepts `{ enabled }` and returns the effective preference with its mandatory flag. Disabling a mandatory preference returns `409` and the current effective state.

There is no generic create notification API.

## Preference policy

1. Critical security and access change notifications are always enabled in app.
2. Account status email is always enabled.
3. Users can control other email delivery.
4. Defaults apply when no override row exists.
5. A template or registry change cannot silently convert a previously optional channel to mandatory without a versioned migration and explicit release note.

## Web and Tauri experience

1. The application shell shows a bell, unread badge, the latest 5 notifications, and a link to `/notifications`.
2. Unread count loads at session start, important navigation, and every 60 seconds while the app is active.
3. `/notifications` uses the existing page scaffold, category and unread filters, newest first list, mark read actions, mark all read header action, and pagination footer.
4. The page includes loading, empty, error, and retry states.
5. A Settings action opens category and channel preferences. Mandatory controls are disabled with a concise explanation.
6. Action routes are internal and registry allowlisted. Event payloads cannot provide external URLs.
7. Tauri renders the same in app interface while open. Native desktop notification is not part of this scope.
8. Timestamps are stored in UTC and rendered with the deployment `DATABASE_TIMEZONE`, currently `Asia/Jakarta`.

## Invitation and auth boundary

1. Normal auth magic link request remains synchronous and auth owned.
2. The invitation producer enqueues `auth.send_user_invitation` with `userId` only.
3. The auth worker creates a token at attempt time, invalidates prior unused invitation tokens for that user, and sends SMTP directly.
4. Invitation content does not appear in the notification center.
5. Raw tokens never enter queue payloads, notification records, logs, or audit metadata.
6. Existing auth cleanup moves from its process timer to the auth owned `auth.cleanup_expired_security_data` recurring job. It remains outside notification content.

## Configuration

Typed environment configuration provides:

1. `NOTIFICATION_SERVICE_PORT`, default `3106`.
2. `NOTIFICATION_DATABASE_URL` for the notification service role.
3. `NOTIFICATION_RETENTION_DAYS`, default `365`.
4. `NOTIFICATION_CLEANUP_INTERVAL_MS`, default one day.
5. `NOTIFICATION_CENTER_ENABLED` for staged route and UI rollout.
6. Existing SMTP configuration for Nodemailer delivery.

## Health and telemetry

1. Readiness verifies database access, registry validity, and required job handlers.
2. Structured events cover notification creation and delivery queued, sent, skipped, and failed.
3. Metrics cover creation latency, unread query latency, delivery outcomes, provider latency, preference skips, missing projection retries, and terminal email failures.
4. Logs contain correlation identifiers and safe type metadata but no rendered sensitive payload or email body.

## Retention

Notifications and deliveries remain for 365 days by default. Cleanup runs in bounded batches and cascades only inside the notification schema. Preferences and active recipient projections remain while relevant. User soft delete does not immediately delete notification history.

## Required tests

1. Self service identity scoping and cross user `404` behavior.
2. Pagination, filters, unread counts, mark one read, and mark all read.
3. Registry validation, immutable rendering, route allowlist, metadata allowlist, and redaction.
4. Effective preference defaults, overrides, mandatory conflict, inactive skip, and account status exception.
5. In app persistence when email fails and no recursive terminal failure notification.
6. Recipient backfill plus user and access projection synchronization.
7. Each registered security, access, account, and operational event producer.
8. Invitation token absence from every persisted and logged surface.
9. Shell polling only while active and all page states in web and Tauri shells.
10. Retention safety and bounded cleanup.
