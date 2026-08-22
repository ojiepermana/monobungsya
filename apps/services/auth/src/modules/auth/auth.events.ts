import {
  USER_INVITED_SUBJECT,
  type UserInvitedEvent,
} from '#project/contracts';
import type { Logger } from '#project/logger';
import type { Subscriber } from '#project/messaging';
import type { AuthService } from './auth.service';

/**
 * Consumes `user.invited` from the user service and emails the new user their
 * first magic link (spec docs/specs/0007-user-management, AC-2).
 *
 * The handler owns the failure: a bad payload, a user who is already inactive,
 * or a mail transport problem is logged and dropped. The create that produced
 * the event has already committed and the user can always request a link
 * themselves, so a retry loop here would buy nothing.
 */
export function subscribeUserInvited(
  messaging: Subscriber,
  service: AuthService,
  logger: Logger,
): void {
  messaging.subscribe<UserInvitedEvent>(USER_INVITED_SUBJECT, async (event) => {
    if (!event?.userId) {
      logger.warn('user.invited.ignored', { reason: 'missing userId' });

      return;
    }

    try {
      const sent = await service.sendInvitation(event.userId);

      if (sent) {
        logger.info('user.invited.sent', { userId: event.userId });
      } else {
        logger.warn('user.invited.skipped', {
          userId: event.userId,
          reason: 'user is missing or not active',
        });
      }
    } catch (error) {
      logger.error('user.invited.failed', {
        userId: event.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
