export type PermissionName = `${string}:${string}:${string}${string}`;

export const PERMISSIONS = {
  userUserList: 'user:user:list',
  userUserRead: 'user:user:read',
  userUserCreate: 'user:user:create',
  userUserUpdate: 'user:user:update',
  userUserSuspend: 'user:user:suspend',
  userUserBlock: 'user:user:block',
  userUserDelete: 'user:user:delete',
  userUserRestore: 'user:user:restore',
  userUserManage: 'user:user:manage',
  logsLogRead: 'logs:log:read',
  observabilityTelemetryRead: 'observability:telemetry:read',
  jobsJobList: 'jobs:job:list',
  jobsJobRead: 'jobs:job:read',
  jobsJobRetry: 'jobs:job:retry',
  jobsJobManage: 'jobs:job:manage',
  accessPermissionList: 'access:permission:list',
  accessPermissionRead: 'access:permission:read',
  accessPermissionCreate: 'access:permission:create',
  accessPermissionUpdate: 'access:permission:update',
  accessPermissionDelete: 'access:permission:delete',
  accessPermissionManage: 'access:permission:manage',
  accessPermissionUserList: 'access:permission_user:list',
  accessPermissionUserCreate: 'access:permission_user:create',
  accessPermissionUserDelete: 'access:permission_user:delete',
  accessPermissionUserManage: 'access:permission_user:manage',
  accessGroupList: 'access:group:list',
  accessGroupRead: 'access:group:read',
  accessGroupCreate: 'access:group:create',
  accessGroupUpdate: 'access:group:update',
  accessGroupDelete: 'access:group:delete',
  accessGroupRestore: 'access:group:restore',
  accessGroupManage: 'access:group:manage',
  accessPermissionGroupList: 'access:permission_group:list',
  accessPermissionGroupCreate: 'access:permission_group:create',
  accessPermissionGroupDelete: 'access:permission_group:delete',
  accessPermissionGroupManage: 'access:permission_group:manage',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export type KnownPermissionName = (typeof PERMISSIONS)[PermissionKey];

export interface PermissionCatalogEntry {
  readonly name: KnownPermissionName;
  readonly code: string;
  readonly namespace: string;
  readonly resource: string;
  readonly action: string;
  readonly scope: string | null;
  readonly description: string;
}

const descriptions: Record<KnownPermissionName, string> = {
  [PERMISSIONS.userUserList]: 'List users',
  [PERMISSIONS.userUserRead]: 'Read a user',
  [PERMISSIONS.userUserCreate]: 'Create users',
  [PERMISSIONS.userUserUpdate]: 'Update user profiles',
  [PERMISSIONS.userUserSuspend]: 'Suspend users',
  [PERMISSIONS.userUserBlock]: 'Block users',
  [PERMISSIONS.userUserDelete]: 'Soft delete users',
  [PERMISSIONS.userUserRestore]: 'Restore users',
  [PERMISSIONS.userUserManage]: 'Manage users',
  [PERMISSIONS.logsLogRead]: 'Read logs',
  [PERMISSIONS.observabilityTelemetryRead]: 'Read runtime telemetry',
  [PERMISSIONS.jobsJobList]: 'List jobs',
  [PERMISSIONS.jobsJobRead]: 'Read job details',
  [PERMISSIONS.jobsJobRetry]: 'Retry failed jobs',
  [PERMISSIONS.jobsJobManage]: 'Manage jobs',
  [PERMISSIONS.accessPermissionList]: 'List permissions',
  [PERMISSIONS.accessPermissionRead]: 'Read a permission',
  [PERMISSIONS.accessPermissionCreate]: 'Create permissions',
  [PERMISSIONS.accessPermissionUpdate]: 'Update permission descriptions',
  [PERMISSIONS.accessPermissionDelete]: 'Delete permissions',
  [PERMISSIONS.accessPermissionManage]: 'Manage permissions',
  [PERMISSIONS.accessPermissionUserList]: 'List user grants',
  [PERMISSIONS.accessPermissionUserCreate]: 'Grant permissions to users',
  [PERMISSIONS.accessPermissionUserDelete]: 'Revoke permissions from users',
  [PERMISSIONS.accessPermissionUserManage]: 'Manage user grants',
  [PERMISSIONS.accessGroupList]: 'List permission groups',
  [PERMISSIONS.accessGroupRead]: 'Read a permission group',
  [PERMISSIONS.accessGroupCreate]: 'Create permission groups',
  [PERMISSIONS.accessGroupUpdate]: 'Update permission groups',
  [PERMISSIONS.accessGroupDelete]: 'Soft delete permission groups',
  [PERMISSIONS.accessGroupRestore]: 'Restore permission groups',
  [PERMISSIONS.accessGroupManage]: 'Manage permission groups',
  [PERMISSIONS.accessPermissionGroupList]: 'List group permissions',
  [PERMISSIONS.accessPermissionGroupCreate]: 'Attach permissions to groups',
  [PERMISSIONS.accessPermissionGroupDelete]: 'Detach permissions from groups',
  [PERMISSIONS.accessPermissionGroupManage]: 'Manage group permissions',
};

function codeFor(name: KnownPermissionName): string {
  return name.replaceAll(':', '_').toUpperCase();
}

function segmentsFor(
  name: KnownPermissionName,
): [string, string, string, string?] {
  return name.split(':') as [string, string, string, string?];
}

export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] =
  Object.values(PERMISSIONS).map((name) => {
    const [namespace, resource, action, scope] = segmentsFor(name);
    return {
      name,
      code: codeFor(name),
      namespace,
      resource,
      action,
      scope: scope ?? null,
      description: descriptions[name],
    };
  });

const permissionNamePattern = /^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*){2,3}$/;

export function normalizePermissions(
  input: readonly string[] | string | null | undefined,
): string[] {
  const values = typeof input === 'string' ? input.split(',') : (input ?? []);
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const permission = value.trim();
    if (!permission || seen.has(permission)) continue;
    seen.add(permission);
    normalized.push(permission);
  }

  return normalized;
}

export function isPermissionName(value: string): boolean {
  return permissionNamePattern.test(value);
}

export function managePermissionFor(requiredPermission: string): string | null {
  const normalized = requiredPermission.trim();
  if (!isPermissionName(normalized)) return null;

  const segments = normalized.split(':');
  return `${segments[0]}:${segments[1]}:manage`;
}

export function hasResolvedPermission(
  grantedPermissions: readonly string[] | string | null | undefined,
  requiredPermission: string,
): boolean {
  const required = requiredPermission.trim();
  if (!isPermissionName(required)) return false;

  const granted = new Set(normalizePermissions(grantedPermissions));
  return (
    granted.has(required) ||
    (managePermissionFor(required) !== null &&
      granted.has(managePermissionFor(required) as string))
  );
}

export function hasAnyRequiredPermission(
  grantedPermissions: readonly string[] | string | null | undefined,
  requiredPermissions: readonly string[],
): boolean {
  return requiredPermissions.some((permission) =>
    hasResolvedPermission(grantedPermissions, permission),
  );
}

export function derivePermissionParts(name: string): {
  code: string;
  namespace: string;
  resource: string;
  action: string;
  scope: string | null;
} | null {
  const normalized = name.trim();
  if (!isPermissionName(normalized)) return null;
  const [namespace, resource, action, scope] = normalized.split(':');
  return {
    code: normalized.replaceAll(':', '_').toUpperCase(),
    namespace: namespace as string,
    resource: resource as string,
    action: action as string,
    scope: scope ?? null,
  };
}
