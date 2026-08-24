DELETE FROM "access"."permission"
WHERE name IN (
  'jobs:job:list',
  'jobs:job:read',
  'jobs:job:retry',
  'jobs:job:manage'
);
