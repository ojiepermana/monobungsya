import type { DatabaseClient } from '#project/database';
import {
  accessNotificationCreateContract,
  accessNotificationRecipientCapabilitySyncContract,
  authNotificationCreateContract,
  DurableJobRuntime,
  DurableJobWorker,
  JobRegistry,
  jobFailureNotificationContract,
  notificationCreateContract,
  notificationEmailDeliveryContract,
  notificationRecipientSyncContract,
  observabilityAlertNotificationContract,
} from '#project/jobs';
import type { Logger } from '#project/logger';
import type { Telemetry } from '#project/telemetry';
import {
  type NotificationMailer,
  NotificationService,
} from '../modules/notification/notification.service';

export function startNotificationWorker(
  database: DatabaseClient,
  logger: Logger,
  mailer?: NotificationMailer,
  telemetry?: Telemetry,
) {
  const registry = new JobRegistry();
  registry.registerContract(notificationCreateContract);
  registry.registerContract(authNotificationCreateContract);
  registry.registerContract(accessNotificationCreateContract);
  registry.registerContract(accessNotificationRecipientCapabilitySyncContract);
  registry.registerContract(notificationRecipientSyncContract);
  registry.registerContract(notificationEmailDeliveryContract);
  registry.registerContract(jobFailureNotificationContract);
  registry.registerContract(observabilityAlertNotificationContract);
  const service = new NotificationService(database, mailer);
  registry.bind(notificationRecipientSyncContract, (payload) =>
    service.syncRecipient(payload),
  );
  registry.bind(notificationCreateContract, async (payload) => {
    await service.create(payload);
  });
  registry.bind(authNotificationCreateContract, async (payload) => {
    await service.create(payload);
  });
  registry.bind(accessNotificationCreateContract, async (payload) => {
    await service.create(payload);
  });
  registry.bind(accessNotificationRecipientCapabilitySyncContract, (payload) =>
    service.syncRecipientCapability(payload),
  );
  registry.bind(notificationEmailDeliveryContract, (payload) =>
    service.sendEmail(payload),
  );
  registry.bind(jobFailureNotificationContract, (payload) =>
    service.fanoutJobFailure(payload),
  );
  registry.bind(observabilityAlertNotificationContract, (payload) =>
    service.fanoutObservabilityAlert(payload),
  );
  const worker = new DurableJobWorker(
    new DurableJobRuntime(database, registry, { telemetry }),
    registry,
    {
      workerId: `notification-${process.pid}`,
      targetService: 'notification',
      telemetry,
      onEvent: (event) => {
        if (event.name === 'job.failed' && event.failure)
          logger.error('notification.job.failed', {
            type: event.job?.type,
            code: event.failure.code,
            message: event.failure.message,
          });
      },
    },
  );
  worker.start();
  return () => worker.stop();
}
