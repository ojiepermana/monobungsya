import { normalizePermissions } from '#project/acl';
import type { AccessRepository } from './access.repository';

interface CacheEntry {
  permissions: string[];
  expiresAt: number;
}

export class PermissionLookupCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly repository: AccessRepository,
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  async get(userId: string): Promise<string[]> {
    const cached = this.entries.get(userId);
    if (cached && cached.expiresAt > Date.now()) return [...cached.permissions];
    this.entries.delete(userId);
    const permissions = normalizePermissions(
      await this.repository.lookupPermissions(userId),
    ).sort();
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
