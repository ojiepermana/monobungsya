import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { PaginationComponent } from './pagination.component';

describe('PaginationComponent', () => {
  it('renders a five-page window around the current page and hides numbers on mobile', () => {
    const fixture = TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    }).createComponent(PaginationComponent);
    fixture.componentRef.setInput('page', 6);
    fixture.componentRef.setInput('totalPages', 10);
    fixture.detectChanges();

    const pageButtons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).filter((button) => /^\d+$/.test(button.textContent?.trim() ?? ''));

    expect(pageButtons.map((button) => button.textContent?.trim())).toEqual([
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
    expect(
      pageButtons.every((button) => button.classList.contains('hidden')),
    ).toBe(true);
    expect(pageButtons[2]?.getAttribute('aria-current')).toBe('page');
  });

  it('emits a selected page and clamps navigation to the available range', () => {
    const fixture = TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    }).createComponent(PaginationComponent);
    fixture.componentRef.setInput('page', 2);
    fixture.componentRef.setInput('totalPages', 3);
    fixture.detectChanges();

    const selectedPages: number[] = [];
    fixture.componentInstance.pageChange.subscribe((page) =>
      selectedPages.push(page),
    );
    const nextButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Next'));

    nextButton?.click();

    expect(selectedPages).toEqual([3]);
  });
});
