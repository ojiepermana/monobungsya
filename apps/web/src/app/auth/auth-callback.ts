import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { client, getApiV1AuthSession } from '#project/angular-sdk';
import { AuthShell } from './auth-shell';

type CallbackState = 'loading' | 'complete' | 'error';

@Component({
  imports: [AuthShell, RouterLink],
  selector: 'app-auth-callback',
  styleUrl: './auth-callback.scss',
  templateUrl: './auth-callback.html',
})
export class AuthCallback {
  protected readonly state = signal<CallbackState>('loading');
  protected readonly userName = signal('');
  private readonly route = inject(ActivatedRoute);

  constructor() {
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
        | { authenticated?: boolean; user?: { name?: string } }
        | undefined;

      if (session?.authenticated && session.user?.name) {
        this.userName.set(session.user.name);
        this.state.set('complete');
        return;
      }
    } catch {
      // The visible callback error state is intentionally generic.
    }

    this.state.set('error');
  }
}
