import { Injectable, inject } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';
import { filter } from 'rxjs';

export interface NavigationCorrelation {
  traceId: string;
  clientRoute: string;
}

@Injectable({ providedIn: 'root' })
export class NavigationCorrelationService {
  private readonly router = inject(Router);
  private pending: NavigationCorrelation | null = null;
  private active: NavigationCorrelation | null = null;

  constructor() {
    this.router.events
      .pipe(
        filter(
          (event) =>
            event instanceof NavigationStart ||
            event instanceof NavigationEnd ||
            event instanceof NavigationCancel ||
            event instanceof NavigationError,
        ),
      )
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          this.pending = {
            traceId: crypto.randomUUID(),
            clientRoute: pathname(event.url),
          };
          return;
        }

        if (event instanceof NavigationEnd) {
          this.active = this.pending ?? {
            traceId: crypto.randomUUID(),
            clientRoute: pathname(event.urlAfterRedirects),
          };
          this.pending = null;
          return;
        }

        this.pending = null;
      });
  }

  current(): NavigationCorrelation | null {
    return this.pending ?? this.active;
  }
}

function pathname(value: string): string {
  return new URL(value, 'http://localhost').pathname;
}
