import { Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { IconComponent } from '@ojiepermana/angular/component/icon';

@Component({
  selector: 'app-pagination',
  imports: [ButtonComponent, IconComponent],
  template: `
    <nav class="flex flex-wrap items-center justify-end gap-2" aria-label="Pagination">
      <button
        Button
        variant="outline"
        size="xs"
        type="button"
        class="size-8 p-0"
        aria-label="First page"
        title="First page"
        [disabled]="loading() || page() <= 1"
        (click)="selectPage(1)"
      >
        <Icon name="first_page" [size]="14" aria-hidden="true" />
      </button>
      <button
        Button
        variant="outline"
        size="xs"
        type="button"
        class="size-8 p-0"
        aria-label="Previous page"
        title="Previous page"
        [disabled]="loading() || page() <= 1"
        (click)="selectPage(page() - 1)"
      >
        <Icon name="chevron_left" [size]="14" aria-hidden="true" />
      </button>
      @for (pageNumber of pageNumbers(); track pageNumber) {
        <button
          Button
          variant="outline"
          size="xs"
          type="button"
          class="hidden min-w-8 sm:inline-flex"
          [class.bg-primary]="pageNumber === page()"
          [class.text-primary-foreground]="pageNumber === page()"
          [attr.aria-current]="pageNumber === page() ? 'page' : null"
          [attr.aria-label]="'Go to page ' + pageNumber"
          [disabled]="loading() || pageNumber === page()"
          (click)="selectPage(pageNumber)"
        >
          {{ pageNumber }}
        </button>
      }
      <button
        Button
        variant="outline"
        size="xs"
        type="button"
        class="size-8 p-0"
        aria-label="Next page"
        title="Next page"
        [disabled]="loading() || page() >= totalPageCount()"
        (click)="selectPage(page() + 1)"
      >
        <Icon name="chevron_right" [size]="14" aria-hidden="true" />
      </button>
      <button
        Button
        variant="outline"
        size="xs"
        type="button"
        class="size-8 p-0"
        aria-label="Last page"
        title="Last page"
        [disabled]="loading() || page() >= totalPageCount()"
        (click)="selectPage(totalPageCount())"
      >
        <Icon name="last_page" [size]="14" aria-hidden="true" />
      </button>
    </nav>
  `,
})
export class PaginationComponent {
  readonly page = input(1);
  readonly totalPages = input(0);
  readonly loading = input(false);
  readonly pageChange = output<number>();

  protected readonly totalPageCount = computed(() =>
    Math.max(this.totalPages(), 1),
  );
  protected readonly pageNumbers = computed(() => {
    const totalPages = this.totalPageCount();
    const currentPage = Math.min(Math.max(this.page(), 1), totalPages);
    const firstPage = Math.max(Math.min(currentPage - 2, totalPages - 4), 1);
    const count = Math.min(totalPages, 5);

    return Array.from({ length: count }, (_, index) => firstPage + index);
  });

  protected selectPage(page: number): void {
    const selectedPage = Math.min(Math.max(page, 1), this.totalPageCount());
    if (selectedPage !== this.page()) {
      this.pageChange.emit(selectedPage);
    }
  }
}
