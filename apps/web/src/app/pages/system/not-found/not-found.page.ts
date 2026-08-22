import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink],
  host: { class: 'block h-full min-h-0' },
  template: `
    <main class="grid h-full place-items-center p-6 text-center">
      <section>
        <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">404</p>
        <h1 class="mt-2 text-2xl font-semibold text-foreground">Halaman tidak ditemukan</h1>
        <a routerLink="/" class="mt-5 inline-flex border border-border px-4 py-2 text-sm font-medium text-foreground">Kembali ke overview</a>
      </section>
    </main>
  `,
})
export class NotFoundPage {}
