import { normalizePermissions } from '#project/acl';
import { ServiceUnavailableError } from '#project/errors';

interface PermissionCacheEntry {
  permissions: string[];
  expiresAt: number;
}

export class GatewayPermissionCache {
  private readonly entries = new Map<string, PermissionCacheEntry>();

  constructor(
    private readonly serviceUrl: string,
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  async get(userId: string, requestId: string): Promise<string[]> {
    const cached = this.entries.get(userId);
    if (cached && cached.expiresAt > Date.now()) return [...cached.permissions];
    this.entries.delete(userId);

    let response: Response;
    try {
      const url = new URL(
        '/internal/access/permissions/lookup',
        this.serviceUrl,
      );
      url.searchParams.set('userId', userId);
      response = await fetch(url, { headers: { 'x-request-id': requestId } });
    } catch {
      throw new ServiceUnavailableError(
        'Permission lookup service is unavailable',
        'permission_lookup_failed',
      );
    }

    if (!response.ok) {
      throw new ServiceUnavailableError(
        'Permission lookup failed',
        'permission_lookup_failed',
      );
    }

    const body = (await response.json()) as { permissions?: unknown };
    if (
      !Array.isArray(body.permissions) ||
      body.permissions.some((value) => typeof value !== 'string')
    ) {
      throw new ServiceUnavailableError(
        'Permission lookup returned an invalid response',
        'permission_lookup_failed',
      );
    }

    const permissions = normalizePermissions(body.permissions).sort();
    this.entries.set(userId, {
      permissions,
      expiresAt: Date.now() + this.ttlMs,
    });
    this.trim();
    return [...permissions];
  }

  invalidate(userId?: string): void {
    if (userId) this.entries.delete(userId);
    else this.entries.clear();
  }

  private trim(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
