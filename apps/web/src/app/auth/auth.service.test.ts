import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureGeneratedClient } from '../../api/generated-client';
import { AuthService } from './auth.service';

const authenticatedResponse = {
  authenticated: true,
  user: {
    id: 'user-1',
    name: 'System User',
    email: 'user@example.com',
    permissions: ['logs.log.read'],
  },
};

describe('AuthService session state', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    configureGeneratedClient('https://gateway.example.test', () => null);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('covers spec 0013 AC-5 and AC-13: token verification bypasses the SDK and is left to browser navigation', async () => {
    const service = new AuthService();
    const next = vi.fn();

    // jsdom's window.location is unforgeable, so the navigation target itself
    // is exercised by the e2e suite; this locks the SDK boundary: a token
    // verify must never issue a fetch and its observable never emits.
    const subscription = service
      .verifyMagicLink('magic-token-value')
      .subscribe({ next });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it('maps an authenticated session and exposes the user state', async () => {
    fetchMock.mockResolvedValue(Response.json(authenticatedResponse));
    const service = new AuthService();

    const user = await firstValueFrom(service.loadCurrentUser());

    expect(user).toMatchObject({
      id: 'user-1',
      email: 'user@example.com',
      permissions: ['logs.log.read'],
    });
    expect(service.user()).toEqual(user);
    expect(service.loaded()).toBe(true);
    expect(service.sessionState()).toBe('authenticated');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('maps an anonymous session without leaking a stale user', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        authenticated: false,
        sessionObservation: { state: 'anonymous', reason: 'missing' },
      }),
    );
    const service = new AuthService();

    const user = await firstValueFrom(service.loadCurrentUser());

    expect(user).toBeNull();
    expect(service.user()).toBeNull();
    expect(service.loaded()).toBe(true);
    expect(service.sessionState()).toBe('unauthenticated');
  });

  it('shares concurrent session checks with one gateway request', async () => {
    let resolveResponse: (response: Response) => void = () => undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    fetchMock.mockReturnValue(pendingResponse);
    const service = new AuthService();

    const first = firstValueFrom(service.loadCurrentUser());
    const second = firstValueFrom(service.loadCurrentUser());

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    resolveResponse(Response.json(authenticatedResponse));

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ id: 'user-1' }),
      expect.objectContaining({ id: 'user-1' }),
    ]);
  });

  it('marks a failed session check and retries from a clean state', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(Response.json(authenticatedResponse));
    const service = new AuthService();

    await expect(firstValueFrom(service.loadCurrentUser())).rejects.toThrow(
      'Gateway request failed with status 0',
    );
    expect(service.sessionState()).toBe('service-error');
    expect(service.loaded()).toBe(false);
    expect(service.user()).toBeNull();

    const user = await firstValueFrom(service.retrySession());

    expect(user?.email).toBe('user@example.com');
    expect(service.sessionState()).toBe('authenticated');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('posts logout and clears the authenticated session', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(authenticatedResponse))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const service = new AuthService();

    await firstValueFrom(service.loadCurrentUser());
    await firstValueFrom(service.logout());

    const logoutRequest = fetchMock.mock.calls[1]?.[0] as Request;
    expect(logoutRequest.method).toBe('POST');
    expect(logoutRequest.url).toBe(
      'https://gateway.example.test/api/v1/auth/logout',
    );
    expect(service.user()).toBeNull();
    expect(service.loaded()).toBe(true);
    expect(service.sessionState()).toBe('unauthenticated');
  });

  it('allows retrySession to replace a cached authenticated session', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(authenticatedResponse))
      .mockResolvedValueOnce(
        Response.json({
          authenticated: false,
          sessionObservation: { state: 'anonymous', reason: 'expired' },
        }),
      );
    const service = new AuthService();

    await firstValueFrom(service.loadCurrentUser());
    const retriedUser = await firstValueFrom(service.retrySession());

    expect(retriedUser).toBeNull();
    expect(service.user()).toBeNull();
    expect(service.sessionState()).toBe('unauthenticated');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
