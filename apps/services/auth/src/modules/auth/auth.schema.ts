import { t } from 'elysia';

export const authStatusResponse = t.Object({
  service: t.String(),
  status: t.Literal('ok'),
  module: t.Literal('auth'),
});
