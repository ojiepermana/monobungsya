import { DOCUMENT } from '@angular/common';
import { inject, Service } from '@angular/core';

const LABELS_ID: Readonly<Record<string, string>> = {
  Monobungsya: 'Monobungsya',
  'MONOBUNGSYA · Login': 'MONOBUNGSYA · Masuk',
  'MONOBUNGSYA · Verify': 'MONOBUNGSYA · Verifikasi',
  'MONOBUNGSYA · User Access': 'MONOBUNGSYA · Akses Pengguna',
  'MONOBUNGSYA · Logs': 'MONOBUNGSYA · Log',
  'MONOBUNGSYA · Audit Logs': 'MONOBUNGSYA · Log Audit',
  'User Access': 'Akses Pengguna',
  'Audit Logs': 'Log Audit',
  Filters: 'Filter',
  Search: 'Cari',
  Clear: 'Bersihkan',
  Create: 'Buat',
  Edit: 'Ubah',
  Delete: 'Hapus',
  Save: 'Simpan',
  Cancel: 'Batal',
  Retry: 'Coba lagi',
  First: 'Pertama',
  Previous: 'Sebelumnya',
  Next: 'Berikutnya',
  Last: 'Terakhir',
  Time: 'Waktu',
  Action: 'Tindakan',
  Entity: 'Entitas',
  Actor: 'Pelaku',
  'Change Summary': 'Ringkasan Perubahan',
  Event: 'Peristiwa',
  Message: 'Pesan',
  Reason: 'Alasan',
  Role: 'Peran',
  Outcome: 'Hasil',
  Level: 'Level',
  Module: 'Modul',
  Name: 'Nama',
  Email: 'Email',
  Status: 'Status',
  Active: 'Aktif',
  Suspended: 'Ditangguhkan',
  'Loading...': 'Memuat...',
  'No user data matches the current filters.':
    'Tidak ada pengguna yang cocok dengan filter saat ini.',
  'No audit records match the current filters.':
    'Tidak ada catatan audit yang cocok dengan filter saat ini.',
  'No access events match the current filters.':
    'Tidak ada peristiwa akses yang cocok dengan filter saat ini.',
  'No application events match the current filters.':
    'Tidak ada peristiwa aplikasi yang cocok dengan filter saat ini.',
};

@Service()
export class UiLabelLocalizationService {
  private readonly document = inject(DOCUMENT);
  private readonly observer = new MutationObserver(() => this.localize());

  start(): void {
    this.localize();
    this.observer.observe(this.document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'placeholder', 'title'],
    });
  }

  stop(): void {
    this.observer.disconnect();
  }

  private localize(): void {
    const walker = this.document.createTreeWalker(
      this.document.documentElement,
      NodeFilter.SHOW_TEXT,
    );
    let node = walker.nextNode() as Text | null;

    while (node) {
      const translated = this.translate(node.data);
      if (translated !== node.data) node.data = translated;
      node = walker.nextNode() as Text | null;
    }

    for (const element of this.document.querySelectorAll<HTMLElement>(
      '[aria-label], [placeholder], [title]',
    )) {
      for (const name of ['aria-label', 'placeholder', 'title']) {
        const value = element.getAttribute(name);
        const translated = value === null ? null : this.translate(value);
        if (translated !== null && translated !== value)
          element.setAttribute(name, translated);
      }
    }
  }

  private translate(value: string): string {
    const leading = value.match(/^\s*/)?.[0] ?? '';
    const trailing = value.match(/\s*$/)?.[0] ?? '';
    const label = value.trim();
    if (!label) return value;

    const translated = LABELS_ID[label] ?? this.translatePageLabel(label);

    return `${leading}${translated}${trailing}`;
  }

  private translatePageLabel(value: string): string {
    const page = value.match(/^Page (\d+) of (\d+)(.*)$/);
    if (page) return `Halaman ${page[1]} dari ${page[2]}${page[3]}`;

    return value;
  }
}
