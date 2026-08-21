import { Component, inject, signal } from '@angular/core';
import { ApiService, type AccessLogItem } from '../../../services/api.service';

@Component({
  selector: 'app-access-logs-page',
  host: { class: 'block h-full min-h-0' },
  template: `
    <main class="grid h-full min-h-0 content-start gap-6 overflow-auto p-6">
      <header>
        <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Logs</p>
        <h1 class="mt-2 text-2xl font-semibold text-foreground">Access Logs</h1>
      </header>
      @if (loading()) {
        <p class="text-sm text-muted-foreground">Memuat access log...</p>
      } @else if (items().length === 0) {
        <p class="border border-border bg-card p-5 text-sm text-muted-foreground">Belum ada access log.</p>
      } @else {
        <div class="overflow-auto border border-border bg-card">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-border text-xs uppercase text-muted-foreground"><tr><th class="px-4 py-3">Event</th><th class="px-4 py-3">Outcome</th><th class="px-4 py-3">Actor</th></tr></thead>
            <tbody>
              @for (item of items(); track $index) {
                <tr class="border-b border-border last:border-0"><td class="px-4 py-3">{{ item.event }}</td><td class="px-4 py-3">{{ item.outcome }}</td><td class="px-4 py-3">{{ item.actorEmail ?? '-' }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </main>
  `,
})
export class AccessLogsPage {
  private readonly api = inject(ApiService);
  protected readonly items = signal<AccessLogItem[]>([]);
  protected readonly loading = signal(true);

  constructor() {
    this.api.accessLogs({ search: '', event: '', outcome: '', page: 1 }).subscribe({
      next: (response) => {
        this.items.set(response.data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}