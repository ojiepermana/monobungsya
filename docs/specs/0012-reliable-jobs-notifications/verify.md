# Verification Plan

**Status**: Planned

**Parent**: [Reliable background jobs and notification center](./index.md)

## Automated verification

1. Run `bun run lint`.
2. Run `bun run typecheck` after root scripts include the jobs and notification services.
3. Run `bun run test` after the root test target includes both services and `#project/jobs`.
4. Run `bun run openapi:validate`.
5. Run `bun run openapi:generate`, then confirm no unexpected generated SDK drift.
6. Run migration up and down tests for jobs and notification schemas with all database roles.

## Durable job scenarios

1. Commit a source mutation and job together, then force enqueue failure and prove the mutation rolls back.
2. Race multiple workers for the same rows and prove a single active lease per job.
3. Kill a worker after claim, wait for lease expiry, and prove another worker resumes the job.
4. Simulate side effect completion before worker death and prove handler idempotency prevents duplicate domain state.
5. Disable NATS and prove polling continues processing within the configured interval.
6. Drive retryable and non retryable failures through their expected state transitions.
7. Repeat manual retry with the same `Idempotency-Key` and prove only one linked job and one strict audit action exist.
8. Run due schedules across timezone boundaries and service restarts without duplicate occurrences.
9. Attempt cross target claims and arbitrary producer updates with restricted database roles and prove denial.
10. Verify the old auth cleanup timer is absent after cutover and the registered cleanup occurrence produces the same domain result.
11. Verify webhook handlers reject payload supplied URLs and credentials, then resolve only a registered integration key from target service configuration.

## Notification scenarios

1. Produce one event from each security, access, account, and terminal job category and verify recipient, template, metadata, route, and channels.
2. Fail SMTP after in app creation and prove the in app record remains while email retries independently.
3. Disable an optional channel and verify delivery becomes skipped. Attempt to disable a mandatory channel and verify `409`.
4. Suspend a recipient and prove normal new deliveries skip while an already processed account status notification can finish.
5. Remove a recipient projection temporarily and prove `recipient_not_ready` retries until synchronization completes.
6. Query as two users and prove notification identifiers never expose cross user data.
7. Verify unread count, category count, list filtering, mark one read, mark all read, and pagination.
8. Force a notification pipeline terminal failure and prove no recursive failure notification is created.
9. Create an invitation and scan job rows, attempts, logs, notifications, and audit metadata to prove no raw token is present.

## User experience scenarios

1. Verify shell bell loading, latest 5 preview, badge updates, and active only 60 second polling.
2. Verify notification loading, empty, populated, error, retry, filter, read, and pagination states.
3. Verify preference controls and mandatory explanations.
4. Verify jobs list filters, detail timeline, sanitized payload, and retry reason dialog for allowed and denied users.
5. Repeat key notification flows in Tauri and verify no native push is emitted.

## Operational acceptance

1. Health and readiness fail safely when database functions or registry versions are missing.
2. Queue summary and metrics expose depth, age, throughput, failures, retries, lease recovery, and delivery outcomes without payload content.
3. Retention cleanup removes only eligible terminal data in bounded batches.
4. Graceful shutdown stops claims, keeps heartbeats during drain, and releases unfinished work after timeout.
5. Staged invitation cutover completes without dual publish and can follow the documented one release rollback window.
