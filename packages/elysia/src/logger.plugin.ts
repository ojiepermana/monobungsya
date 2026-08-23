import { Elysia } from 'elysia';
import type { Logger } from '#project/logger';

export function createLoggerPlugin(logger: Logger, name = 'logger') {
  // Request traffic is recorded at the public gateway boundary as access
  // rows. Internal services keep this compatibility plugin so callers can
  // retain the same composition shape, but they no longer duplicate every
  // request into application logs.
  void logger;
  return new Elysia({ name });
}
