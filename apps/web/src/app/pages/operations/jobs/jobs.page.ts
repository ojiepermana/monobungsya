import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import {
  NativeSelectComponent,
  NativeSelectOptionDirective,
} from '@ojiepermana/angular/component/native-select';
import {
  TableBodyComponent,
  TableCaptionComponent,
  TableCellComponent,
  TableComponent,
  TableHeadComponent,
  TableHeaderComponent,
  TableRowComponent,
} from '@ojiepermana/angular/component/table';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import {
  PageComponent,
  PageContentComponent,
  PageFooterComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import {
  ApiService,
  type JobRecord,
  type LogsMeta,
} from '../../../services/api.service';

const DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const EMPTY_META: LogsMeta = { page: 1, perPage: 25, total: 0, totalPages: 0 };

@Component({
  selector: 'app-jobs-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    ButtonComponent,
    NativeSelectComponent,
    NativeSelectOptionDirective,
    PageComponent,
    PageContentComponent,
    PageFooterComponent,
    PageHeaderComponent,
    RouterLink,
    TableBodyComponent,
    TableCaptionComponent,
    TableCellComponent,
    TableComponent,
    TableHeadComponent,
    TableHeaderComponent,
    TableRowComponent,
  ],
  template: `
    <Page variant="stacked" scroll="content" [appearance]="layout.appearance()" class="h-full min-h-0">
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-6">
        <div><p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Operations</p><h1 class="text-lg font-semibold text-foreground">Durable jobs</h1></div>
        <select NativeSelect [value]="status()" (change)="changeStatus($event)">
          @for (option of statuses; track option.value) { <option NativeSelectOption [value]="option.value">{{ option.label }}</option> }
        </select>
      </PageHeader>
      <PageContent class="grid min-h-0 content-start gap-4">
        @if (error()) { <p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{{ error() }}</p> }
        @if (loading()) { <p class="text-sm text-muted-foreground">Memuat jobs...</p> }
        @else if (rows().length === 0) { <p class="border border-border bg-card p-5 text-sm text-muted-foreground">Belum ada job.</p> }
        @else {
          <Table class="min-w-full bg-card"><caption TableCaption class="sr-only">Daftar durable jobs</caption><thead TableHeader class="text-xs uppercase text-muted-foreground"><tr TableRow><th TableHead scope="col">Jenis</th><th TableHead scope="col">Target</th><th TableHead scope="col">Status</th><th TableHead scope="col">Percobaan</th><th TableHead scope="col">Dibuat</th></tr></thead><tbody TableBody>
            @for (job of rows(); track job.id) { <tr TableRow><td TableCell><a class="font-medium text-foreground underline-offset-4 hover:underline" [routerLink]="['/operations/jobs', job.id]">{{ job.type }} @{{ job.version }}</a></td><td TableCell class="text-muted-foreground">{{ job.sourceService }} → {{ job.targetService }}</td><td TableCell><span class="font-mono text-xs">{{ job.status }}</span></td><td TableCell>{{ job.attemptCount }} / {{ job.maxAttempts }}</td><td TableCell class="whitespace-nowrap font-mono text-xs">{{ formatDate(job.createdAt) }}</td></tr> }
          </tbody></Table>
        }
      </PageContent>
      <PageFooter class="flex min-h-(--layout-topbar-height) items-center justify-between gap-3 px-6"><p class="text-sm text-muted-foreground">Halaman {{ meta().page }} dari {{ pageCount() }} · {{ meta().total }} jobs</p><div class="flex gap-2"><button Button variant="outline" size="xs" type="button" [disabled]="loading() || meta().page <= 1" (click)="load(meta().page - 1)">Sebelumnya</button><button Button variant="outline" size="xs" type="button" [disabled]="loading() || meta().page >= meta().totalPages" (click)="load(meta().page + 1)">Berikutnya</button></div></PageFooter>
    </Page>
  `,
})
export class JobsPage {
  protected readonly layout = inject(LayoutService);
  private readonly api = inject(ApiService);
  protected readonly statuses = [
    { value: '', label: 'Semua status' },
    { value: 'queued', label: 'Queued' },
    { value: 'running', label: 'Running' },
    { value: 'retry_wait', label: 'Retry wait' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
  ];
  protected readonly status = signal('');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly rows = signal<JobRecord[]>([]);
  protected readonly meta = signal<LogsMeta>(EMPTY_META);
  protected readonly pageCount = () => Math.max(this.meta().totalPages, 1);
  constructor() {
    this.load(1);
  }
  protected load(page: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.jobs({ page, status: this.status() }).subscribe({
      next: (response) => {
        this.rows.set(response.data);
        this.meta.set(response.meta);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Jobs tidak dapat dimuat.');
        this.loading.set(false);
      },
    });
  }
  protected changeStatus(event: Event): void {
    this.status.set((event.target as HTMLSelectElement).value);
    this.load(1);
  }
  protected formatDate(value: string): string {
    return DATE_FORMAT.format(new Date(value));
  }
}
