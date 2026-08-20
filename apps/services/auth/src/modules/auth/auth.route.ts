import { Elysia } from 'elysia';
import { authStatusResponse } from './auth.schema';
import { AuthService } from './auth.service';

export function createAuthRoute(serviceName: string) {
  const service = new AuthService(serviceName);

  return new Elysia({ name: 'auth-routes' }).get(
    '/internal/auth/status',
    () => service.getStatus(),
    {
      response: { 200: authStatusResponse },
      detail: {
        tags: ['Auth'],
        summary: 'Return auth module status',
      },
    },
  );
}
