import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import { describe, expect, it, vi } from 'vitest';
import { type Passkey, PasskeyService } from '../../../auth/passkey.service';
import { PasskeysSettingsPage } from './passkeys.page';

const passkey: Passkey = {
  id: 'passkey-1',
  label: 'MacBook',
  createdAt: '2026-08-22T00:00:00.000Z',
  lastUsedAt: null,
  backupState: false,
};

async function createPage(rows: Passkey[] = [passkey], supported = true) {
  const passkeys = signal(rows);
  const service = {
    supported: vi.fn(() => supported),
    passkeys,
    load: vi.fn().mockImplementation(async () => {
      passkeys.set(rows);
      return rows;
    }),
    register: vi.fn().mockResolvedValue({ ...passkey, id: 'passkey-2' }),
    rename: vi.fn().mockImplementation(async (id: string, label: string) => ({
      ...passkey,
      id,
      label,
    })),
    remove: vi.fn().mockResolvedValue(undefined),
    messageFrom: vi.fn((_error: unknown, fallback: string) => fallback),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: LayoutService,
        useValue: {
          appearance: () => 'flat',
          type: () => 'vertical',
        },
      },
      { provide: PasskeyService, useValue: service },
    ],
  });

  const fixture = TestBed.createComponent(PasskeysSettingsPage);
  fixture.detectChanges();
  await fixture.whenStable();
  await Promise.resolve();
  fixture.detectChanges();

  return { fixture, service };
}

describe('PasskeysSettingsPage page composition (spec 0006, AC 11)', () => {
  it('uses the shared page slots and keeps the passkey surface inside content', async () => {
    const { fixture } = await createPage();
    const root = fixture.nativeElement.querySelector('page') as HTMLElement;
    const header = root.querySelector('pageheader') as HTMLElement;
    const content = root.querySelector('pagecontent') as HTMLElement;
    const footer = root.querySelector('pagefooter') as HTMLElement;

    expect(root).not.toBeNull();
    expect(root.getAttribute('data-page-variant')).toBe('stacked');
    expect(root.getAttribute('data-page-scroll')).toBe('content');
    expect(root.getAttribute('data-page-appearance')).toBe('flat');
    expect(root.querySelectorAll('pageheader')).toHaveLength(1);
    expect(root.querySelectorAll('pagecontent')).toHaveLength(1);
    expect(root.querySelectorAll('pagefooter')).toHaveLength(1);
    expect(root.querySelector('pagefilter')).toBeNull();
    expect(fixture.nativeElement.querySelector('main')).toBeNull();

    expect(header.textContent).toContain('Settings');
    expect(header.textContent).toContain('Passkey');
    expect(
      header.querySelector('button[button]')?.getAttribute('data-size'),
    ).toBe('xs');
    expect(content.classList.contains('p-6')).toBe(false);
    expect(content.textContent).not.toContain(
      'Passkey membuat Anda bisa masuk',
    );
    expect(content.querySelector('thead[tableheader]')).not.toBeNull();
    expect(content.querySelector('tbody[tablebody]')).not.toBeNull();
    expect(content.querySelector('caption[tablecaption]')).not.toBeNull();
    expect(content.querySelector('table')?.classList.contains('border')).toBe(
      false,
    );
    expect(content.querySelector('div.overflow-auto.border')).toBeNull();
    expect(content.querySelector('button[button]')).not.toBeNull();
    expect(footer.textContent).toContain('1 dari 5 passkey terpakai');
    expect(footer.textContent).toContain('Magic link tetap tersedia');
  });

  it('keeps registration and inline rename actions working after recomposition', async () => {
    const { fixture, service } = await createPage();
    const root = fixture.nativeElement.querySelector('page') as HTMLElement;
    const header = root.querySelector('pageheader') as HTMLElement;
    const content = root.querySelector('pagecontent') as HTMLElement;
    const registerButton = header.querySelector(
      'button[button]',
    ) as HTMLButtonElement;

    registerButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.register).toHaveBeenCalledOnce();
    expect(content.textContent).toContain('berhasil didaftarkan');

    const renameButton = [...content.querySelectorAll('button[button]')].find(
      (button) => button.textContent?.includes('Ganti nama'),
    ) as HTMLButtonElement;
    renameButton.click();
    fixture.detectChanges();

    const input = content.querySelector('input') as HTMLInputElement;
    input.value = 'Work laptop';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const saveButton = [...content.querySelectorAll('button[button]')].find(
      (button) => button.textContent?.includes('Simpan'),
    ) as HTMLButtonElement;
    saveButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.rename).toHaveBeenCalledWith('passkey-1', 'Work laptop');
    expect(content.textContent).toContain('Nama passkey diubah menjadi');
  });

  it('keeps the magic link fallback visible when passkeys are unsupported', async () => {
    const { fixture } = await createPage([], false);
    const root = fixture.nativeElement.querySelector('page') as HTMLElement;
    const header = root.querySelector('pageheader') as HTMLElement;
    const content = root.querySelector('pagecontent') as HTMLElement;

    expect(header.querySelector('button[button]')).toBeNull();
    expect(content.textContent).toContain('Passkey belum tersedia');
    expect(root.querySelector('pagefooter')?.textContent).toContain(
      'Magic link tetap tersedia',
    );
  });
});
