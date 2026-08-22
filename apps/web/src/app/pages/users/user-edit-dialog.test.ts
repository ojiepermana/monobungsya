import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { UserRecord } from '../../services/api.service';
import { UserEditDialog } from './user-edit-dialog';

/**
 * Same CDK overlay portal note as reason-dialog.test.ts: the name/role fields
 * only reach the DOM once the dialog is open, so this exercises the component
 * class (its input/output/model contract) directly.
 */
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

function setRole(
  fixture: ReturnType<typeof createDialog>,
  value: string,
): void {
  (
    fixture.componentInstance as unknown as { setRole(event: Event): void }
  ).setRole({ target: { value } } as unknown as Event);
}

function submit(fixture: ReturnType<typeof createDialog>): void {
  (fixture.componentInstance as unknown as { submit(): void }).submit();
}

function testUser(overrides: Partial<UserRecord> = {}): UserRecord {
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

describe('UserEditDialog (spec docs/specs/0007-user-management, AC-3)', () => {
  it('loads the name and role fields from the user input', () => {
    const fixture = createDialog();
    fixture.componentRef.setInput(
      'user',
      testUser({ name: 'Old Name', role: 'manager' }),
    );
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      name(): string;
      role(): string;
    };
    expect(component.name()).toBe('Old Name');
    expect(component.role()).toBe('manager');
  });

  it('reloads the fields whenever a different user is put into the dialog', () => {
    const fixture = createDialog();
    fixture.componentRef.setInput(
      'user',
      testUser({ name: 'First', role: 'staff' }),
    );
    fixture.detectChanges();
    fixture.componentRef.setInput(
      'user',
      testUser({ id: 'user-2', name: 'Second', role: 'admin' }),
    );
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      name(): string;
      role(): string;
    };
    expect(component.name()).toBe('Second');
    expect(component.role()).toBe('admin');
  });

  it('emits only the fields that actually changed', () => {
    const fixture = createDialog();
    fixture.componentRef.setInput(
      'user',
      testUser({ name: 'Jane Staff', role: 'staff' }),
    );
    fixture.detectChanges();
    const emitted: unknown[] = [];
    fixture.componentInstance.saved.subscribe((payload) =>
      emitted.push(payload),
    );

    setName(fixture, 'Jane Staff'); // unchanged, trimmed equal
    setRole(fixture, 'manager'); // changed
    submit(fixture);

    expect(emitted).toEqual([{ role: 'manager' }]);
  });

  it('emits an empty payload when nothing changed but submit is still called directly', () => {
    const fixture = createDialog();
    fixture.componentRef.setInput(
      'user',
      testUser({ name: 'Jane Staff', role: 'staff' }),
    );
    fixture.detectChanges();
    const emitted: unknown[] = [];
    fixture.componentInstance.saved.subscribe((payload) =>
      emitted.push(payload),
    );

    submit(fixture);

    expect(emitted).toEqual([{}]);
  });

  it('does nothing when submit is called with no user loaded', () => {
    const fixture = createDialog();
    const emitted: unknown[] = [];
    fixture.componentInstance.saved.subscribe((payload) =>
      emitted.push(payload),
    );

    submit(fixture);

    expect(emitted).toHaveLength(0);
  });

  it("'changed' is false until the name is non empty, even if the role differs", () => {
    const fixture = createDialog();
    fixture.componentRef.setInput(
      'user',
      testUser({ name: 'Jane Staff', role: 'staff' }),
    );
    fixture.detectChanges();
    setName(fixture, '   ');
    setRole(fixture, 'manager');

    const component = fixture.componentInstance as unknown as {
      changed(): boolean;
    };
    expect(component.changed()).toBe(false);
  });
});
