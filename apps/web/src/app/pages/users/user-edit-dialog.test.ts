import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { UserRecord } from '../../services/api.service';
import { UserEditDialog } from './user-edit-dialog';

function createDialog() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()],
  });
  const fixture = TestBed.createComponent(UserEditDialog);
  fixture.detectChanges();
  return fixture;
}

function setName(
  fixture: ReturnType<typeof createDialog>,
  value: string,
): void {
  (
    fixture.componentInstance as unknown as { setName(event: Event): void }
  ).setName({ target: { value } } as unknown as Event);
}

function submit(fixture: ReturnType<typeof createDialog>): void {
  (fixture.componentInstance as unknown as { submit(): void }).submit();
}

function testUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-1',
    name: 'Jane Staff',
    email: 'jane@project.local',
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

describe('UserEditDialog', () => {
  it('loads and reloads the name from the user input', () => {
    const fixture = createDialog();
    fixture.componentRef.setInput('user', testUser({ name: 'Old Name' }));
    fixture.detectChanges();
    fixture.componentRef.setInput(
      'user',
      testUser({ id: 'user-2', name: 'Second' }),
    );
    fixture.detectChanges();
    expect(
      (fixture.componentInstance as unknown as { name(): string }).name(),
    ).toBe('Second');
  });

  it('emits only a changed name', () => {
    const fixture = createDialog();
    fixture.componentRef.setInput('user', testUser());
    fixture.detectChanges();
    const emitted: unknown[] = [];
    fixture.componentInstance.saved.subscribe((payload) =>
      emitted.push(payload),
    );
    setName(fixture, ' Renamed ');
    submit(fixture);
    expect(emitted).toEqual([{ name: 'Renamed' }]);
  });

  it('emits an empty payload when the name is unchanged', () => {
    const fixture = createDialog();
    fixture.componentRef.setInput('user', testUser());
    fixture.detectChanges();
    const emitted: unknown[] = [];
    fixture.componentInstance.saved.subscribe((payload) =>
      emitted.push(payload),
    );
    submit(fixture);
    expect(emitted).toEqual([{}]);
  });

  it('does nothing without a user', () => {
    const fixture = createDialog();
    const emitted: unknown[] = [];
    fixture.componentInstance.saved.subscribe((payload) =>
      emitted.push(payload),
    );
    submit(fixture);
    expect(emitted).toHaveLength(0);
  });
});
