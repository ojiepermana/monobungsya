import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { client, getApiV1AuthSession } from '#project/angular-sdk';
import { AuthShell } from './auth-shell';

type CallbackState = 'loading' | 'complete' | 'error';

@Component({
  imports: [AuthShell, ButtonComponent, RouterLink],
  selector: 'app-auth-callback',
  styleUrl: './auth-callback.css',
  templateUrl: './auth-callback.html',
})
export class AuthCallback {
  protected readonly state = signal<CallbackState>('loading');
  protected readonly userName = signal('');
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private redirectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.redirectTimer !== undefined) {
        clearTimeout(this.redirectTimer);
      }
    });

    const routeData = this.route.snapshot.data as { mode?: string };

    if (routeData.mode === 'error') {
      this.state.set('error');
      return;
    }

    void this.loadSession();
  }

  private async loadSession(): Promise<void> {
    try {
      const result = await getApiV1AuthSession({ client });
      const session = result.data as
        { authenticated?: boolean; user?: { name?: string } } | undefined;

      if (session?.authenticated && session.user?.name) {
        this.userName.set(session.user.name);
        this.state.set('complete');
        this.redirectTimer = setTimeout(() => {
          void this.router.navigateByUrl('/');
        }, 5000);
        return;
      }
    } catch {
      // The visible callback error state is intentionally generic.
    }

    this.state.set('error');
  }
}
