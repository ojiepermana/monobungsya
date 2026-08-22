import { Component, inject, signal } from '@angular/core';
import { ApiService, type AuthUserAdmin } from '../../../services/api.service';

@Component({
  selector: 'app-user-access-settings-page',
  host: { class: 'block h-full min-h-0' },
  template: `
    <main class="grid h-full min-h-0 content-start gap-6 overflow-auto p-6">
      <header>
        <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Settings</p>
        <h1 class="mt-2 text-2xl font-semibold text-foreground">User Access</h1>
      </header>
      @if (loading()) {
        <p class="text-sm text-muted-foreground">Memuat user...</p>
      } @else if (users().length === 0) {
        <p class="border border-border bg-card p-5 text-sm text-muted-foreground">Belum ada user.</p>
      } @else {
        <div class="overflow-auto border border-border bg-card">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-border text-xs uppercase text-muted-foreground"><tr><th class="px-4 py-3">Name</th><th class="px-4 py-3">Email</th><th class="px-4 py-3">Role</th></tr></thead>
            <tbody>
              @for (user of users(); track user.id) {
                <tr class="border-b border-border last:border-0"><td class="px-4 py-3">{{ user.name }}</td><td class="px-4 py-3">{{ user.email }}</td><td class="px-4 py-3">{{ user.role }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </main>
  `,
})
export class UserAccessSettingsPage {
  private readonly api = inject(ApiService);
  protected readonly users = signal<AuthUserAdmin[]>([]);
  protected readonly loading = signal(true);

  constructor() {
    this.api.authUsers({ search: '' }).subscribe({
      next: (response) => {
        this.users.set(response.data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
