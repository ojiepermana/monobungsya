import { Elysia, t } from 'elysia';
import { PERMISSIONS } from '#project/acl';
import { createAuthIdentityPlugin } from '../../shared/plugins/auth-identity.plugin';
import { accessCorrelation, actorFromIdentity } from './access.route.helpers';
import {
  copyGrantBody,
  grantBody,
  grantMutationResponse,
  grantParams,
  grantsResponse,
  groupApplyBody,
  groupApplyResponse,
  groupAttachBody,
  groupBulkApplyResponse,
  groupCreateBody,
  groupIdParams,
  groupListQuery,
  groupListResponse,
  groupMutationResponse,
  groupPermissionsResponse,
  groupResponse,
  groupUpdateBody,
  groupUserParams,
  lookupResponse,
  permissionCreateBody,
  permissionIdParams,
  permissionListQuery,
  permissionListResponse,
  permissionLookupQuery,
  permissionResponse,
  permissionUpdateBody,
  userApplyGroupBody,
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
      '/api/v1/access/groups',
      ({ query, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessGroupList);
        return service.listGroups(query);
      },
      {
        query: groupListQuery,
        response: { 200: groupListResponse },
        detail: { tags: ['Access'], summary: 'List permission groups' },
      },
    )
    .post(
      '/api/v1/access/groups',
      ({ body, identity, request, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessGroupCreate);
        return service.createGroup(
          body,
          actorFromIdentity(identity),
          accessCorrelation(request),
        );
      },
      {
        body: groupCreateBody,
        response: { 200: groupResponse },
        detail: { tags: ['Access'], summary: 'Create a permission group' },
      },
    )
    .get(
      '/api/v1/access/groups/:id',
      ({ params, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessGroupRead);
        return service.getGroup(params.id);
      },
      {
        params: groupIdParams,
        response: { 200: groupResponse },
        detail: { tags: ['Access'], summary: 'Read a permission group' },
      },
    )
    .put(
      '/api/v1/access/groups/:id',
      ({ params, body, identity, request, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessGroupUpdate);
        return service.updateGroup(
          params.id,
          body,
          actorFromIdentity(identity),
          accessCorrelation(request),
        );
      },
      {
        params: groupIdParams,
        body: groupUpdateBody,
        response: { 200: groupResponse },
        detail: { tags: ['Access'], summary: 'Update a permission group' },
      },
    )
    .delete(
      '/api/v1/access/groups/:id',
      async ({ params, identity, request, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessGroupDelete);
        await service.deleteGroup(
          params.id,
          actorFromIdentity(identity),
          accessCorrelation(request),
        );
        return new Response(null, { status: 204 });
      },
      {
        params: groupIdParams,
        detail: { tags: ['Access'], summary: 'Soft delete a permission group' },
      },
    )
    .post(
      '/api/v1/access/groups/:id/restore',
      ({ params, identity, request, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessGroupRestore);
        return service.restoreGroup(
          params.id,
          actorFromIdentity(identity),
          accessCorrelation(request),
        );
      },
      {
        params: groupIdParams,
        response: { 200: groupResponse },
        detail: { tags: ['Access'], summary: 'Restore a permission group' },
      },
    )
    .get(
      '/api/v1/access/groups/:id/permissions',
      ({ params, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessPermissionGroupList);
        return service.listGroupPermissions(params.id);
      },
      {
        params: groupIdParams,
        response: { 200: groupPermissionsResponse },
        detail: { tags: ['Access'], summary: 'List group permissions' },
      },
    )
    .post(
      '/api/v1/access/groups/:id/permissions',
      ({ params, body, identity, request, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessPermissionGroupCreate);
        return service.attachGroupPermissions(
          params.id,
          body.permissionIds,
          actorFromIdentity(identity),
          accessCorrelation(request),
        );
      },
      {
        params: groupIdParams,
        body: groupAttachBody,
        response: { 200: groupMutationResponse },
        detail: { tags: ['Access'], summary: 'Attach permissions to a group' },
      },
    )
    .delete(
      '/api/v1/access/groups/:id/permissions/:permissionId',
      async ({ params, identity, request, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessPermissionGroupDelete);
        await service.detachGroupPermission(
          params.id,
          params.permissionId,
          actorFromIdentity(identity),
          accessCorrelation(request),
        );
        return new Response(null, { status: 204 });
      },
      {
        params: t.Object({
          id: t.String({ format: 'uuid' }),
          permissionId: t.String({ format: 'uuid' }),
        }),
        detail: {
          tags: ['Access'],
          summary: 'Detach a permission from a group',
        },
      },
    )
    .post(
      '/api/v1/access/groups/:id/apply',
      ({ params, body, identity, request, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessPermissionUserCreate);
        return service.applyGroupToUsers(
          params.id,
          body.userIds,
          actorFromIdentity(identity),
          accessCorrelation(request),
        );
      },
      {
        params: groupIdParams,
        body: groupApplyBody,
        response: { 200: groupBulkApplyResponse },
        detail: {
          tags: ['Access'],
          summary: 'Apply a permission group to users',
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
      '/api/v1/access/users/:userId/permissions/apply-group',
      ({ params, body, identity, request, requirePermissions }) => {
        requirePermissions(PERMISSIONS.accessPermissionUserCreate);
        return service.applyGroupToUser(
          params.userId,
          body.groupId,
          actorFromIdentity(identity),
          accessCorrelation(request),
        );
      },
      {
        params: groupUserParams,
        body: userApplyGroupBody,
        response: { 200: groupApplyResponse },
        detail: {
          tags: ['Access'],
          summary: 'Apply a permission group to a user',
        },
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
