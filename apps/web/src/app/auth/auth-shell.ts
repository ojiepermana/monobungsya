import { Component } from '@angular/core';

@Component({
  selector: 'app-auth-shell',
  host: { class: 'block min-h-full' },
  template: `
    <main class="min-h-full overflow-auto bg-background text-foreground">
      <div class="mx-auto grid min-h-full w-full max-w-7xl lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
        <section class="flex min-h-full flex-col px-5 py-6 sm:px-10 sm:py-8 lg:px-16 lg:py-10">
          <header class="flex items-center justify-between gap-4 border-b border-border pb-5">
            <a class="inline-flex min-h-11 items-center gap-3 text-sm font-semibold tracking-[0.08em] text-foreground no-underline" href="/" aria-label="Monobungsya workspace">
              <span class="grid size-9 place-items-center rounded-full bg-foreground text-background" aria-hidden="true">M</span>
              <span>MONOBUNGSYA</span>
            </a>
            <span class="text-xs uppercase tracking-[0.16em] text-muted-foreground">Secure access</span>
          </header>

          <div class="flex flex-1 items-center py-12 sm:py-16">
            <ng-content></ng-content>
          </div>

          <footer class="border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
            Access is protected by a server managed session. Never share a sign in link.
          </footer>
        </section>

        <aside class="relative hidden min-h-full overflow-hidden border-l border-border bg-muted p-10 lg:flex lg:flex-col lg:justify-between">
          <div class="absolute inset-0 opacity-50" aria-hidden="true">
            <div class="h-full w-full bg-[linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(to_right,var(--border)_1px,transparent_1px)] bg-[size:3rem_3rem]"></div>
          </div>
          <div class="relative">
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Operations console</p>
            <h2 class="mt-6 max-w-sm font-serif text-5xl font-normal leading-[0.96] tracking-[-0.03em] text-foreground xl:text-6xl">
              A clear path into the work.
            </h2>
            <p class="mt-6 max-w-sm text-sm leading-6 text-muted-foreground">
              Monobungsya keeps daily operations, access, and system signals in one calm workspace.
            </p>
          </div>
          <div class="relative grid gap-3 text-xs text-muted-foreground">
            <div class="flex items-center gap-3 border-t border-border pt-3">
              <span class="size-2 rounded-full bg-primary" aria-hidden="true"></span>
              <span>Server session protection</span>
            </div>
            <div class="flex items-center gap-3 border-t border-border pt-3">
              <span class="size-2 rounded-full bg-accent" aria-hidden="true"></span>
              <span>One time sign in links</span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  `,
})
export class AuthShell {}
