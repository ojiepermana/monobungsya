import type { BadgeVariant } from '@ojiepermana/angular/component/badge';
import type {
  UserRecord,
  UserStatus,
  UserStatusAction,
} from '../../services/api.service';

/** Indonesian labels for the derived status, matching the log viewer pages. */
export const STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Aktif',
  suspended: 'Ditangguhkan',
  blocked: 'Diblokir',
  deleted: 'Dihapus',
};

export const STATUS_VARIANTS: Record<UserStatus, BadgeVariant> = {
  active: 'secondary',
  suspended: 'outline',
  blocked: 'destructive',
  deleted: 'destructive',
};

export interface StatusActionMeta {
  action: UserStatusAction;
  label: string;
  /** What the confirm dialog says before the reason field. */
  question: string;
  destructive: boolean;
}

const ACTIONS: Record<UserStatusAction, StatusActionMeta> = {
  suspend: {
    action: 'suspend',
    label: 'Tangguhkan',
    question:
      'User tidak bisa login sampai penangguhan dibuka. Sesi aktif berhenti pada request berikutnya.',
    destructive: false,
  },
  unsuspend: {
    action: 'unsuspend',
    label: 'Buka penangguhan',
    question: 'User bisa login kembali setelah penangguhan dibuka.',
    destructive: false,
  },
  block: {
    action: 'block',
    label: 'Blokir',
    question:
      'User diblokir dan tidak bisa login. Status penangguhan tetap tersimpan.',
    destructive: true,
  },
  unblock: {
    action: 'unblock',
    label: 'Buka blokir',
    question:
      'User kembali ke status sebelumnya, ditangguhkan jika sebelumnya ditangguhkan.',
    destructive: false,
  },
  delete: {
    action: 'delete',
    label: 'Hapus',
    question:
      'Baris user tidak pernah dihapus permanen; hanya ditandai terhapus dan bisa dipulihkan.',
    destructive: true,
  },
  restore: {
    action: 'restore',
    label: 'Pulihkan',
    question: 'User kembali ke status yang dimilikinya sebelum dihapus.',
    destructive: false,
  },
};

/**
 * Which actions a user can take right now, mirroring the transitions the user
 * service enforces (spec docs/specs/0007-user-management). The server stays the
 * authority: an action the UI offers by mistake still returns 409.
 *
 * A status action on the caller's own account is always refused (AC-6), so it
 * is not offered at all. Editing your own name remains allowed.
 */
export function actionsFor(
  user: UserRecord,
  callerId?: string | null,
): StatusActionMeta[] {
  if (callerId && user.id === callerId) {
    return [];
  }

  if (user.status === 'deleted') {
    return [ACTIONS.restore];
  }

  const available: StatusActionMeta[] = [];

  if (user.status === 'active') {
    available.push(ACTIONS.suspend);
  }

  if (user.status === 'suspended') {
    available.push(ACTIONS.unsuspend);
  }

  if (user.status === 'active' || user.status === 'suspended') {
    available.push(ACTIONS.block);
  }

  if (user.status === 'blocked') {
    available.push(ACTIONS.unblock);
  }

  available.push(ACTIONS.delete);

  return available;
}

/**
 * The 409 reason the API returns, turned into something an admin can act on.
 * Unknown reasons fall back to the server message.
 */
export function statusActionError(error: unknown): string {
  const body = (
    error as { error?: { error?: { reason?: string; message?: string } } }
  )?.error?.error;

  switch (body?.reason) {
    case 'self_action':
      return 'Kamu tidak bisa mengubah status akunmu sendiri.';
    case 'last_active_admin':
      return 'Admin aktif terakhir tidak bisa dinonaktifkan atau diturunkan.';
    case 'invalid_transition':
      return 'Status user sudah berubah. Muat ulang halaman lalu coba lagi.';
    case 'user_deleted':
      return 'User sudah terhapus; hanya pemulihan yang bisa dilakukan.';
    case 'user_id_taken':
      return 'Id user sudah dipakai. Tutup dialog lalu coba lagi.';
    case 'user_email_taken':
      return 'Email sudah dipakai user lain.';
    default:
      return body?.message ?? 'Aksi gagal dijalankan.';
  }
}
