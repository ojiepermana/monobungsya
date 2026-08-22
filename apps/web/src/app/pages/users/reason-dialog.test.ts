import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ReasonDialog } from './reason-dialog';

/**
 * `ReasonDialog`'s markup (the textarea, the confirm button) lives inside the
 * `@ojiepermana/angular` `Dialog` component, which portals its content into a
 * CDK overlay attached to `document.body` only once `open` becomes true, not
 * into this fixture's own DOM. So these tests exercise the component class
 * directly (the same public input/output/model contract a consumer relies
 * on), rather than querying rendered DOM. The confirm button's disabled state
 * (busy or fewer than 3 characters) is a template binding on top of that same
 * `reason` signal; it was checked visually in /check verify's suspend step and
 * is noted as not covered by an automated DOM test here.
 */
function createDialog() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()],
  });

  const fixture = TestBed.createComponent(ReasonDialog);
  fixture.detectChanges();

  return fixture;
}

function typeReason(
  fixture: ReturnType<typeof createDialog>,
  value: string,
): void {
  (
    fixture.componentInstance as unknown as {
      updateReason(event: Event): void;
    }
  ).updateReason({ target: { value } } as unknown as Event);
}

describe('ReasonDialog (spec docs/specs/0007-user-management, AC-4, AC-7)', () => {
  it('defaults to the generic confirmation copy', () => {
    const fixture = createDialog();
    const component = fixture.componentInstance;

    expect(component.title()).toBe('Konfirmasi');
    expect(component.description()).toBe('');
    expect(component.confirmLabel()).toBe('Konfirmasi');
    expect(component.destructive()).toBe(false);
    expect(component.open()).toBe(false);
  });

  it('emits the trimmed reason on confirm', () => {
    const fixture = createDialog();
    const component = fixture.componentInstance;
    const emitted: string[] = [];
    component.confirmed.subscribe((reason) => emitted.push(reason));

    typeReason(fixture, '  policy violation  ');
    (component as unknown as { confirm(): void }).confirm();

    expect(emitted).toEqual(['policy violation']);
  });

  it('clears the typed reason and closes the dialog on cancel', () => {
    const fixture = createDialog();
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('open', true);
    typeReason(fixture, 'some reason');

    (component as unknown as { cancel(): void }).cancel();

    expect((component as unknown as { reason(): string }).reason()).toBe('');
    expect(component.open()).toBe(false);
  });

  it('reset() clears any typed reason so the next open starts clean (called by the host after success)', () => {
    const fixture = createDialog();
    const component = fixture.componentInstance;
    typeReason(fixture, 'leftover text from a previous action');

    component.reset();

    expect((component as unknown as { reason(): string }).reason()).toBe('');
  });
});
