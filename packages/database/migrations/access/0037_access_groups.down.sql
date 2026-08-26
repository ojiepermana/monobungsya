DROP TABLE IF EXISTS "access"."permission_group";
DROP TABLE IF EXISTS "access"."group";

DELETE FROM "access"."permission"
WHERE name IN (
  'access:group:list',
  'access:group:read',
  'access:group:create',
  'access:group:update',
  'access:group:delete',
  'access:group:restore',
  'access:group:manage',
  'access:permission_group:list',
  'access:permission_group:create',
  'access:permission_group:delete',
  'access:permission_group:manage'
);
