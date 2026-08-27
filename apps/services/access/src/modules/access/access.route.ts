import { Elysia } from 'elysia';
import { PERMISSIONS } from '#project/acl';
import { createAuthIdentityPlugin } from '../../shared/plugins/auth-identity.plugin';
import { accessCorrelation, actorFromIdentity } from './access.route.helpers';
import {
  copyGrantBody,
  grantBody,
  grantMutationResponse,
  grantParams,
  grantsResponse,
  lookupResponse,
  permissionCreateBody,
  permissionIdParams,
  permissionListQuery,
  permissionListResponse,
  permissionLookupQuery,
  permissionResponse,
  permissionUpdateBody,
  userIdParams,
} from './access.schema';
import type { AccessServiceOptions } from './access.service';
import { AccessService } from './access.service';

export function createAccessRoute(
  options: AccessServiceOptions & {
    signingSecret?: string;
    clockSkewSeconds?: number;
  } = {},
) {
  const service = new AccessService(options);
  const identityPlugin = createAuthIdentityPlugin(
    options.signingSecret ?? '',
    options.clockSkewSeconds ?? 30,
  );

  return new Elysia({ name: 'access-routes' })
    .get(
      '/internal/access/permissions/lookup',
      async ({ query }) => ({
        permissions: await service.lookupPermissions(query.userId),
      }),
      {
        query: permissionLookupQuery,
        response: { 200: lookupResponse },
        detail: {
          hide: true,
          summary: 'Resolve effective permissions for a user',
        },
      },
    )
    .use(identityPlugin)
    .get(
      '/api/v1/access/permissions',
      ({ query, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessPermissionList);
        return service.listPermissions(query);
      },
      {
        query: permissionListQuery,
        response: { 200: permissionListResponse },
        detail: { tags: ['Access'], summary: 'List the permission catalog' },
      },
    )
    .post(
      '/api/v1/access/permissions',
      ({ body, identity, request, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessPermissionCreate);
        return service.createPermission(
          body,
          actorFromIdentity(identity),
          accessCorrelation(request),
        );
      },
      {
        body: permissionCreateBody,
        response: { 200: permissionResponse },
        detail: { tags: ['Access'], summary: 'Create a permission' },
      },
    )
    .get(
      '/api/v1/access/permissions/:id',
      ({ params, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessPermissionRead);
        return service.getPermission(params.id);
      },
      {
        params: permissionIdParams,
        response: { 200: permissionResponse },
        detail: { tags: ['Access'], summary: 'Read a permission' },
      },
    )
    .put(
      '/api/v1/access/permissions/:id',
      ({ params, body, identity, request, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessPermissionUpdate);
        return service.updatePermission(
          params.id,
          body.description,
          actorFromIdentity(identity),
          accessCorrelation(request),
        );
      },
      {
        params: permissionIdParams,
        body: permissionUpdateBody,
        response: { 200: permissionResponse },
        detail: {
          tags: ['Access'],
          summary: 'Update a permission description',
        },
      },
    )
    .delete(
      '/api/v1/access/permissions/:id',
      async ({ params, identity, request, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessPermissionDelete);
        await service.deletePermission(
          params.id,
          actorFromIdentity(identity),
          accessCorrelation(request),
        );
        return new Response(null, { status: 204 });
      },
      {
        params: permissionIdParams,
        detail: {
          tags: ['Access'],
          summary: 'Delete a permission and its grants',
        },
      },
    )
    .get(
      '/api/v1/access/users/:userId/permissions',
      ({ params, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessPermissionUserList);
        return service.listGrants(params.userId);
      },
      {
        params: userIdParams,
        response: { 200: grantsResponse },
        detail: { tags: ['Access'], summary: 'List a user permissions' },
      },
    )
    .post(
      '/api/v1/access/users/:userId/permissions',
      ({ params, body, identity, request, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessPermissionUserCreate);
        return service.grantPermissions(
          params.userId,
          body.permissionIds,
          actorFromIdentity(identity),
          accessCorrelation(request),
        );
      },
      {
        params: userIdParams,
        body: grantBody,
        response: { 200: grantMutationResponse },
        detail: { tags: ['Access'], summary: 'Grant permissions to a user' },
      },
    )
    .post(
      '/api/v1/access/users/:userId/permissions/copy',
      ({ params, body, identity, request, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessPermissionUserCreate);
        return service.copyPermissions(
          params.userId,
          body.sourceUserId,
          actorFromIdentity(identity),
          accessCorrelation(request),
        );
      },
      {
        params: userIdParams,
        body: copyGrantBody,
        response: { 200: grantMutationResponse },
        detail: {
          tags: ['Access'],
          summary: 'Copy permissions from another user',
        },
      },
    )
    .delete(
      '/api/v1/access/users/:userId/permissions/:permissionId',
      async ({ params, identity, request, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessPermissionUserDelete);
        await service.revokePermission(
          params.userId,
          params.permissionId,
          actorFromIdentity(identity),
          accessCorrelation(request),
        );
        return new Response(null, { status: 204 });
      },
      {
        params: grantParams,
        detail: { tags: ['Access'], summary: 'Revoke a user permission' },
      },
    );
}
