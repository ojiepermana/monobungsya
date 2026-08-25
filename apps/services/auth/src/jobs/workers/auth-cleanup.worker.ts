import type { DatabaseClient } from '#project/database';
import {
  authCleanupExpiredSecurityDataContract,
  authSendUserInvitationContract,
  DurableJobRuntime,
  DurableJobWorker,
  JobRegistry,
  jobFailureNotificationContract,
} from '#project/jobs';
import type { Logger } from '#project/logger';
import type { Telemetry } from '#project/telemetry';
import type { AuthRepository } from '../../modules/auth/auth.repository';
import type { AuthService } from '../../modules/auth/auth.service';

export function startAuthJobWorker(
  database: DatabaseClient,
  repository: AuthRepository,
  service: AuthService,
  logger: Logger,
  telemetry?: Telemetry,
): () => Promise<void> {
  const registry = new JobRegistry();
  registry.registerContract(authSendUserInvitationContract);
  registry.registerContract(authCleanupExpiredSecurityDataContract);
  registry.registerContract(jobFailureNotificationContract);
  registry.bind(authSendUserInvitationContract, async (payload) => {
    const sent = await service.sendInvitation(payload.userId);
    if (!sent) {
      logger.warn('auth.invitation.skipped', {
        userId: payload.userId,
        reason: 'user is missing or not active',
      });
    }
  });
  registry.bind(authCleanupExpiredSecurityDataContract, async () => {
    const result = await repository.cleanup();
    logger.info('auth.cleanup.completed', { ...result });
  });

  const runtime = new DurableJobRuntime(database, registry, { telemetry });
  const worker = new DurableJobWorker(runtime, registry, {
    workerId: `auth-${process.pid}`,
    targetService: 'auth',
    telemetry,
    onEvent: (event) => {
      if (event.name === 'job.failed' && event.failure) {
        logger.error('auth.job.failed', {
          type: event.job?.type,
          code: event.failure.code,
          message: event.failure.message,
        });
      } else if (event.name === 'job.worker_error') {
        logger.error('auth.job.worker_error', {
          type: event.job?.type,
          error:
            event.error instanceof Error
              ? event.error.message
              : String(event.error),
        });
      }
    },
  });
  worker.start();

  return () => worker.stop();
}
