import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureGeneratedClient } from '../../api/generated-client';
import { ApiService } from './api.service';

const emptyUser = {
  id: '0198f8a0-0000-7000-8000-0000000000aa',
  name: 'Jane',
  email: 'jane@example.com',
  status: 'active',
  emailVerifiedAt: null,
  suspendedAt: null,
  blockedAt: null,
  deletedAt: null,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: null,
};

describe('ApiService generated gateway transport', () => {
  let service: ApiService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    configureGeneratedClient('https://gateway.example.test', () => ({
      traceId: 'trace-1',
      clientRoute: '/users',
    }));
    service = new ApiService();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('uses the generated users operation with typed query values and credentials', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [emptyUser],
        meta: { page: 2, perPage: 25, total: 1, totalPages: 1 },
        filters: { search: 'jane', status: 'active' },
        options: { statuses: ['active'] },
      }),
    );

    await firstValueFrom(
      service.users({ search: 'jane', status: 'active', page: 2 }),
    );

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe(
      'https://gateway.example.test/api/v1/users?search=jane&status=active&page=2',
    );
    expect(request.credentials).toBe('include');
    expect(request.headers.get('x-correlation-id')).toBe('trace-1');
    expect(request.headers.get('x-client-route')).toBe('/users');
  });

  it('maps user mutations to generated operations and preserves the body', async () => {
    fetchMock.mockResolvedValue(Response.json(emptyUser));

    await firstValueFrom(
      service.runUserStatusAction('user-1', 'suspend', 'policy violation'),
    );

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe('POST');
    expect(request.url).toBe(
      'https://gateway.example.test/api/v1/users/user-1/suspend',
    );
    expect(await request.json()).toEqual({ reason: 'policy violation' });
  });

  it('omits an actor filter when it is not supplied', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [],
        meta: { page: 1, perPage: 25, total: 0, totalPages: 0 },
        filters: { search: '', module: '', action: '' },
        options: { modules: [], actions: [] },
      }),
    );

    await firstValueFrom(
      service.auditTrails({ search: '', module: '', action: '', page: 1 }),
    );

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).not.toContain('actorUserId=');
  });

  it('turns a gateway error into a status carrying error', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: 'FORBIDDEN', message: 'Not allowed' } },
        { status: 403 },
      ),
    );

    await expect(
      firstValueFrom(service.users({ search: '', status: '', page: 1 })),
    ).rejects.toMatchObject({ status: 403 });
  });
});
