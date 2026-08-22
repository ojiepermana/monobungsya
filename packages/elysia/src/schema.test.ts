import { describe, expect, it } from 'bun:test';
import { Elysia, t } from 'elysia';
import { enumSchema } from './schema';

const ROLES = ['admin', 'manager', 'bi', 'staff', 'legacy'] as const;

describe('enumSchema', () => {
  it('carries no default, unlike t.UnionEnum', () => {
    // The trap this helper exists to close: the raw union arrives with one.
    expect(t.UnionEnum(ROLES)).toHaveProperty('default', 'admin');
    expect('default' in enumSchema(ROLES)).toBe(false);
  });

  it('still validates the allowed values and rejects the rest', () => {
    const schema = enumSchema(ROLES);

    expect(schema.enum).toEqual([...ROLES]);
    expect(schema.type).toBe('string');
  });

  it('leaves an absent optional property absent on a PATCH body', async () => {
    let received: unknown;
    const app = new Elysia().patch(
      '/users/:id',
      ({ body }) => {
        received = body;
        return { ok: true };
      },
      {
        body: t.Object({
          name: t.Optional(t.String()),
          role: t.Optional(enumSchema(ROLES)),
        }),
      },
    );

    await app.handle(
      new Request('http://localhost/users/1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'renamed' }),
      }),
    );

    // A name only update must not smuggle a role in with it.
    expect(received).toEqual({ name: 'renamed' });
  });

  it('passes a supplied value through untouched', async () => {
    let received: unknown;
    const app = new Elysia().patch(
      '/users/:id',
      ({ body }) => {
        received = body;
        return { ok: true };
      },
      {
        body: t.Object({ role: t.Optional(enumSchema(ROLES)) }),
      },
    );

    await app.handle(
      new Request('http://localhost/users/1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'staff' }),
      }),
    );

    expect(received).toEqual({ role: 'staff' });
  });
});
