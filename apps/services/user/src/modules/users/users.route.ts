import { Elysia } from 'elysia';
import { usersStatusResponse } from './users.schema';
import { UsersService } from './users.service';

export function createUsersRoute(serviceName: string) {
  const service = new UsersService(serviceName);

  return new Elysia({ name: 'users-routes' }).get(
    '/internal/users/status',
    () => service.getStatus(),
    {
      response: { 200: usersStatusResponse },
      detail: { tags: ['Users'], summary: 'Return users module status' },
    },
  );
}
