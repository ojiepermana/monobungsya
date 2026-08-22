import { describe, expect, it } from 'vitest';
import type { UserRecord, UserStatus } from '../../services/api.service';
import {
  actionsFor,
  STATUS_LABELS,
  STATUS_VARIANTS,
  statusActionError,
} from './user-status';

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-1',
    name: 'Jane Staff',
    email: 'jane@project.local',
    role: 'staff',
    status: 'active',
    emailVerifiedAt: null,
    suspendedAt: null,
    blockedAt: null,
    deletedAt: null,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

describe('actionsFor (spec docs/specs/0007-user-management, AC-4, AC-5, AC-6)', () => {
  it('offers suspend and block for an active user', () => {
    const actions = actionsFor(user({ status: 'active' })).map((a) => a.action);
    expect(actions).toEqual(['suspend', 'block', 'delete']);
  });

  it('offers unsuspend and block for a suspended user, mirroring the escalation transition', () => {
    const actions = actionsFor(user({ status: 'suspended' })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(['unsuspend', 'block', 'delete']);
  });

  it('offers only unblock and delete for a blocked user', () => {
    const actions = actionsFor(user({ status: 'blocked' })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(['unblock', 'delete']);
  });

  it('offers only restore for a deleted user, never a second delete', () => {
    const actions = actionsFor(user({ status: 'deleted' })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(['restore']);
  });

  it("offers no actions at all against the caller's own account (AC-6 self guard)", () => {
    const target = user({ id: 'same-id', status: 'active' });
    expect(actionsFor(target, 'same-id')).toEqual([]);
  });

  it('still offers actions when callerId is absent or belongs to someone else', () => {
    const target = user({ id: 'user-1', status: 'active' });
    expect(actionsFor(target, null)).not.toEqual([]);
    expect(actionsFor(target, undefined)).not.toEqual([]);
    expect(actionsFor(target, 'someone-else')).not.toEqual([]);
  });

  it('marks block, delete, and restore as destructive, and the rest as not', () => {
    const active = actionsFor(user({ status: 'active' }));
    const deleted = actionsFor(user({ status: 'deleted' }));

    expect(active.find((a) => a.action === 'suspend')?.destructive).toBe(false);
    expect(active.find((a) => a.action === 'block')?.destructive).toBe(true);
    expect(active.find((a) => a.action === 'delete')?.destructive).toBe(true);
    expect(deleted.find((a) => a.action === 'restore')?.destructive).toBe(
      false,
    );
  });
});

describe('statusActionError (spec docs/specs/0007-user-management)', () => {
  function errorWithReason(reason: string) {
    return { error: { error: { reason, message: 'server message' } } };
  }

  it.each([
    ['self_action', 'Kamu tidak bisa mengubah status akunmu sendiri.'],
    [
      'last_active_admin',
      'Admin aktif terakhir tidak bisa dinonaktifkan atau diturunkan.',
    ],
    [
      'invalid_transition',
      'Status user sudah berubah. Muat ulang halaman lalu coba lagi.',
    ],
    [
      'user_deleted',
      'User sudah terhapus; hanya pemulihan yang bisa dilakukan.',
    ],
    ['user_id_taken', 'Id user sudah dipakai. Tutup dialog lalu coba lagi.'],
    ['user_email_taken', 'Email sudah dipakai user lain.'],
  ])('maps reason %s to its Indonesian message', (reason, expected) => {
    expect(statusActionError(errorWithReason(reason))).toBe(expected);
  });

  it('falls back to the server message for an unrecognised reason', () => {
    expect(statusActionError(errorWithReason('something_new'))).toBe(
      'server message',
    );
  });

  it('falls back to a generic message when there is no reason or message at all', () => {
    expect(statusActionError({})).toBe('Aksi gagal dijalankan.');
    expect(statusActionError(new Error('network down'))).toBe(
      'Aksi gagal dijalankan.',
    );
  });
});

describe('STATUS_LABELS and STATUS_VARIANTS', () => {
  it('cover every derived status with a non empty label and variant', () => {
    const statuses: UserStatus[] = [
      'active',
      'suspended',
      'blocked',
      'deleted',
    ];

    for (const status of statuses) {
      expect(STATUS_LABELS[status]).toBeTruthy();
      expect(STATUS_VARIANTS[status]).toBeTruthy();
    }
  });

  it('marks blocked and deleted as destructive variants, matching their severity', () => {
    expect(STATUS_VARIANTS.blocked).toBe('destructive');
    expect(STATUS_VARIANTS.deleted).toBe('destructive');
    expect(STATUS_VARIANTS.active).not.toBe('destructive');
  });
});
