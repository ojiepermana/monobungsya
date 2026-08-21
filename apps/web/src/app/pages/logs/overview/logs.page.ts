import { Component, inject, signal } from '@angular/core';
import { ApiService } from '../../../services/api.service';

@Component({
  selector: 'app-logs-page',
  host: { class: 'block h-full min-h-0' },
  template: `
    <main class="grid h-full min-h-0 content-start gap-6 overflow-auto p-6">
      <header>
        <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Overview</p>
        <h1 class="mt-2 text-2xl font-semibold text-foreground">Log Overview</h1>
        <p class="mt-2 max-w-2xl text-sm text-muted-foreground">Pantau kesiapan gateway dan akses ke area operasional ETOS Payroll.</p>
      </header>

      <section class="grid gap-4 md:grid-cols-2" aria-label="System status">
        <article class="border border-border bg-card p-5">
          <p class="text-sm text-muted-foreground">Gateway</p>
          <p class="mt-3 text-xl font-semibold text-foreground">{{ gatewayStatus() }}</p>
        </article>
        <article class="border border-border bg-card p-5">
          <p class="text-sm text-muted-foreground">Workspace</p>
          <p class="mt-3 text-xl font-semibold text-foreground">ETOS Payroll</p>
        </article>
      </section>
    </main>
  `,
})
export class LogsPage {
  private readonly api = inject(ApiService);
  protected readonly gatewayStatus = signal('Checking...');

  constructor() {
    this.api.health().subscribe({
      next: () => this.gatewayStatus.set('Online'),
      error: () => this.gatewayStatus.set('Unavailable'),
    });
  }
}