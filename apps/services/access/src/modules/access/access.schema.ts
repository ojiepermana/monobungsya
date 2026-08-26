import { t } from 'elysia';

const permissionName = t.String({
  minLength: 5,
  maxLength: 100,
  pattern: '^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*){2,3}$',
});
const nullableString = t.Union([t.String({ maxLength: 2000 }), t.Null()]);

export const permissionIdParams = t.Object({
  id: t.String({ format: 'uuid' }),
});
export const permissionLookupQuery = t.Object({
  userId: t.String({ format: 'uuid' }),
});
export const userIdParams = t.Object({ userId: t.String({ format: 'uuid' }) });
export const grantParams = t.Object({
  userId: t.String({ format: 'uuid' }),
  permissionId: t.String({ format: 'uuid' }),
});

export const permissionListQuery = t.Object({
  page: t.Optional(t.String({ maxLength: 8 })),
  pageSize: t.Optional(t.String({ maxLength: 8 })),
  search: t.Optional(t.String({ maxLength: 255 })),
  namespace: t.Optional(t.String({ maxLength: 50 })),
});

export const permissionCreateBody = t.Object({
  name: permissionName,
  description: t.Optional(nullableString),
});

export const permissionUpdateBody = t.Object({
  description: nullableString,
});

const groupStatus = t.Union([t.Literal('active'), t.Literal('off')]);
const groupDeletedFilter = t.Union([
  t.Literal('exclude'),
  t.Literal('include'),
  t.Literal('only'),
]);

export const groupListQuery = t.Object({
  page: t.Optional(t.String({ maxLength: 8 })),
  pageSize: t.Optional(t.String({ maxLength: 8 })),
  search: t.Optional(t.String({ maxLength: 255 })),
  status: t.Optional(groupStatus),
  deleted: t.Optional(groupDeletedFilter),
  appliable: t.Optional(t.String({ pattern: '^(true|false)$' })),
});

export const groupIdParams = t.Object({
  id: t.String({ format: 'uuid' }),
});

export const groupUserParams = t.Object({
  userId: t.String({ format: 'uuid' }),
});

export const groupCreateBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 100 }),
  description: t.Optional(nullableString),
  status: t.Optional(groupStatus),
});

export const groupUpdateBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  description: t.Optional(nullableString),
  status: t.Optional(groupStatus),
});

export const groupAttachBody = t.Object({
  permissionIds: t.Array(t.String({ format: 'uuid' }), {
    minItems: 1,
    maxItems: 100,
  }),
});

export const groupApplyBody = t.Object({
  userIds: t.Array(t.String({ format: 'uuid' }), {
    minItems: 1,
    maxItems: 50,
  }),
});

export const userApplyGroupBody = t.Object({
  groupId: t.String({ format: 'uuid' }),
});

export const grantBody = t.Object({
  permissionIds: t.Array(t.String({ format: 'uuid' }), {
    minItems: 1,
    maxItems: 100,
  }),
});

export const copyGrantBody = t.Object({
  sourceUserId: t.String({ format: 'uuid' }),
});

export const permissionResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  code: t.String(),
  namespace: t.String(),
  resource: t.String(),
  action: t.String(),
  scope: t.Union([t.String(), t.Null()]),
  description: t.Union([t.String(), t.Null()]),
  grantCount: t.Optional(t.Integer()),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const permissionListResponse = t.Object({
  data: t.Array(permissionResponse),
  meta: t.Object({
    page: t.Integer(),
    pageSize: t.Integer(),
    total: t.Integer(),
    totalPages: t.Integer(),
  }),
  filters: t.Object({ search: t.String(), namespace: t.String() }),
});

export const groupResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  status: groupStatus,
  description: t.Union([t.String(), t.Null()]),
  permissionCount: t.Integer(),
  createdAt: t.String(),
  updatedAt: t.String(),
  deletedAt: t.Union([t.String(), t.Null()]),
});

export const groupPermissionsResponse = t.Array(permissionResponse);

export const groupListResponse = t.Object({
  data: t.Array(groupResponse),
  meta: t.Object({
    page: t.Integer(),
    pageSize: t.Integer(),
    total: t.Integer(),
    totalPages: t.Integer(),
  }),
  filters: t.Object({
    search: t.String(),
    status: t.String(),
    deleted: groupDeletedFilter,
    appliable: t.Boolean(),
  }),
});

export const groupMutationResponse = t.Object({
  attached: t.Array(t.String({ format: 'uuid' })),
  skipped: t.Array(t.String({ format: 'uuid' })),
});

export const groupApplyResponse = t.Object({
  granted: t.Array(t.String({ format: 'uuid' })),
  skipped: t.Array(t.String({ format: 'uuid' })),
});

export const groupBulkApplyResponse = t.Object({
  applied: t.Array(
    t.Object({
      userId: t.String({ format: 'uuid' }),
      granted: t.Array(t.String({ format: 'uuid' })),
      skipped: t.Array(t.String({ format: 'uuid' })),
    }),
  ),
  failed: t.Array(
    t.Object({
      userId: t.String({ format: 'uuid' }),
      reason: t.String(),
    }),
  ),
});

export const grantResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  permissionId: t.String({ format: 'uuid' }),
  userId: t.String({ format: 'uuid' }),
  permission: permissionResponse,
  createdAt: t.String(),
});

export const grantsResponse = t.Array(grantResponse);
export const grantMutationResponse = t.Object({
  granted: t.Array(t.String({ format: 'uuid' })),
  skipped: t.Array(t.String({ format: 'uuid' })),
});
export const lookupResponse = t.Object({ permissions: t.Array(t.String()) });
