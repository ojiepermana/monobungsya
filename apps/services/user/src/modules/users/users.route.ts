import { Elysia } from 'elysia';
import { PERMISSIONS } from '#project/acl';
import type { AuthIdentity } from '#project/contracts';
import type { DatabaseClient } from '#project/database';
import { UnauthorizedError } from '#project/errors';
import type { Logger } from '#project/logger';
import type { Publisher } from '#project/messaging';
import { createAuthIdentityPlugin } from '../../shared/plugins/auth-identity.plugin';
import {
  createUserBody,
  statusActionBody,
  updateUserBody,
  userIdParams,
  userResponse,
  usersListQuery,
  usersListResponse,
  usersStatusResponse,
} from './users.schema';
import { UsersService } from './users.service';
import type {
  RequestCorrelation,
  UserActor,
  UserStatusAction,
} from './users.types';

export interface UsersRouteOptions {
  database?: DatabaseClient;
  messaging?: Publisher;
  logger?: Logger;
  signingSecret?: string;
  clockSkewSeconds?: number;
}

/**
 * Every mutation needs a verified actor for its audit trail, so a request that
 * carries no identity is rejected here rather than audited as anonymous. The
 * identity is null only when identity signing is switched off, which also means
 * no database is configured, so no mutation could run anyway.
 */
function requireActor(identity: AuthIdentity | null): UserActor {
  if (!identity) {
    throw new UnauthorizedError('A valid signed identity is required');
  }

  return {
    id: identity.userId,
    email: identity.email,
  };
}

function correlationOf(request: Request): RequestCorrelation {
  return {
    requestId: request.headers.get('x-request-id'),
    ipAddress:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: request.headers.get('user-agent'),
  };
}

/** Shared shape for the six status action routes; only the reason differs. */
function statusActionSchema(action: UserStatusAction) {
  return {
    params: userIdParams,
    body: statusActionBody,
    response: { 200: userResponse },
    detail: {
      tags: ['Users'],
      summary: `${action.charAt(0).toUpperCase()}${action.slice(1)} a user`,
    },
  };
}

export function createUsersRoute(
  serviceName: string,
  options: UsersRouteOptions = {},
) {
  const service = new UsersService(serviceName, options);
  const run = (
    action: UserStatusAction,
    id: string,
    reason: string,
    identity: AuthIdentity | null,
    request: Request,
  ) =>
    service.applyStatusAction(
      id,
      action,
      reason,
      requireActor(identity),
      correlationOf(request),
    );

  return (
    new Elysia({ name: 'users-routes' })
      // The module owns its own gate: the whole user domain is admin only, and
      // the resolved identity is the audit actor for every mutation below.
      // Registered before the parameterised routes so the stub keeps answering
      // on /internal/users/status instead of being read as a user id.
      .get('/internal/users/status', () => service.getStatus(), {
        response: { 200: usersStatusResponse },
        detail: { tags: ['Users'], summary: 'Return users module status' },
      })
      .use(
        createAuthIdentityPlugin(
          options.signingSecret ?? '',
          options.clockSkewSeconds ?? 30,
        ),
      )
      .get(
        '/internal/users',
        ({ query, requirePermissions }) => {
          requirePermissions(PERMISSIONS.userUserList);
          return service.list(query);
        },
        {
          query: usersListQuery,
          response: { 200: usersListResponse },
          detail: {
            tags: ['Users'],
            summary: 'List users with search, status filter, and paging',
          },
        },
      )
      .get(
        '/internal/users/:id',
        ({ params, requirePermissions }) => {
          requirePermissions(PERMISSIONS.userUserRead);
          return service.detail(params.id);
        },
        {
          params: userIdParams,
          response: { 200: userResponse },
          detail: { tags: ['Users'], summary: 'Read one user' },
        },
      )
      .post(
        '/internal/users',
        ({ body, identity, request, requirePermissions }) => {
          requirePermissions(PERMISSIONS.userUserCreate);
          return service.create(
            body,
            requireActor(identity),
            correlationOf(request),
          );
        },
        {
          body: createUserBody,
          response: { 200: userResponse },
          detail: {
            tags: ['Users'],
            summary: 'Create a user with a client generated UUIDv7 id',
          },
        },
      )
      .patch(
        '/internal/users/:id',
        ({ params, body, identity, request, requirePermissions }) => {
          requirePermissions(PERMISSIONS.userUserUpdate);
          return service.update(
            params.id,
            body,
            requireActor(identity),
            correlationOf(request),
          );
        },
        {
          params: userIdParams,
          body: updateUserBody,
          response: { 200: userResponse },
          detail: {
            tags: ['Users'],
            summary: "Update a user's name",
          },
        },
      )
      .post(
        '/internal/users/:id/suspend',
        ({ params, body, identity, request, requirePermissions }) => {
          requirePermissions(PERMISSIONS.userUserSuspend);
          return run('suspend', params.id, body.reason, identity, request);
        },
        statusActionSchema('suspend'),
      )
      .post(
        '/internal/users/:id/unsuspend',
        ({ params, body, identity, request, requirePermissions }) => {
          requirePermissions(PERMISSIONS.userUserSuspend);
          return run('unsuspend', params.id, body.reason, identity, request);
        },
        statusActionSchema('unsuspend'),
      )
      .post(
        '/internal/users/:id/block',
        ({ params, body, identity, request, requirePermissions }) => {
          requirePermissions(PERMISSIONS.userUserBlock);
          return run('block', params.id, body.reason, identity, request);
        },
        statusActionSchema('block'),
      )
      .post(
        '/internal/users/:id/unblock',
        ({ params, body, identity, request, requirePermissions }) => {
          requirePermissions(PERMISSIONS.userUserBlock);
          return run('unblock', params.id, body.reason, identity, request);
        },
        statusActionSchema('unblock'),
      )
      .post(
        '/internal/users/:id/restore',
        ({ params, body, identity, request, requirePermissions }) => {
          requirePermissions(PERMISSIONS.userUserRestore);
          return run('restore', params.id, body.reason, identity, request);
        },
        statusActionSchema('restore'),
      )
      // Soft delete only: the handler sets deleted_at, it never issues a DELETE
      // against the table. The reason travels in the body.
      .delete(
        '/internal/users/:id',
        ({ params, body, identity, request, requirePermissions }) => {
          requirePermissions(PERMISSIONS.userUserDelete);
          return run('delete', params.id, body.reason, identity, request);
        },
        statusActionSchema('delete'),
      )
  );
}
