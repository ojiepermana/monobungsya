import { Component, inject, signal } from '@angular/core';
import { ApiService, type ApplicationLogItem } from '../../../services/api.service';

@Component({
  selector: 'app-application-logs-page',
  host: { class: 'block h-full min-h-0' },
  template: `
    <main class="grid h-full min-h-0 content-start gap-6 overflow-auto p-6">
      <header>
        <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Logs</p>
        <h1 class="mt-2 text-2xl font-semibold text-foreground">Application Logs</h1>
      </header>
      @if (loading()) {
        <p class="text-sm text-muted-foreground">Memuat application log...</p>
      } @else if (items().length === 0) {
        <p class="border border-border bg-card p-5 text-sm text-muted-foreground">Belum ada application log.</p>
      } @else {
        <div class="overflow-auto border border-border bg-card">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-border text-xs uppercase text-muted-foreground"><tr><th class="px-4 py-3">Level</th><th class="px-4 py-3">Message</th><th class="px-4 py-3">Time</th></tr></thead>
            <tbody>
              @for (item of items(); track item.id) {
                <tr class="border-b border-border last:border-0"><td class="px-4 py-3">{{ item.level }}</td><td class="px-4 py-3">{{ item.message }}</td><td class="px-4 py-3">{{ item.occurredAt }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </main>
  `,
})
export class ApplicationLogsPage {
  private readonly api = inject(ApiService);
  protected readonly items = signal<ApplicationLogItem[]>([]);
  protected readonly loading = signal(true);

  constructor() {
    this.api.applicationLogs({ search: '', level: '', module: '', event: '', page: 1 }).subscribe({
      next: (response) => {
        this.items.set(response.data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}