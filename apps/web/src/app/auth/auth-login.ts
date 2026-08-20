import { Component, signal } from '@angular/core';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { InputComponent } from '@ojiepermana/angular/component/input';
import { LabelComponent } from '@ojiepermana/angular/component/label';
import { client, postApiV1AuthMagicLink } from '#project/angular-sdk';
import { AuthShell } from './auth-shell';

type LoginState = 'idle' | 'submitting' | 'sent' | 'rate-limited' | 'error';

@Component({
  imports: [AuthShell, ButtonComponent, InputComponent, LabelComponent],
  selector: 'app-auth-login',
  styleUrl: './auth-login.css',
  templateUrl: './auth-login.html',
})
export class AuthLogin {
  protected readonly email = signal('');
  protected readonly state = signal<LoginState>('idle');
  protected readonly errorMessage = signal('');

  async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    const email = this.email().trim();

    if (!email?.includes('@')) {
      this.state.set('error');
      this.errorMessage.set('Enter a valid work email address.');
      return;
    }

    this.state.set('submitting');
    this.errorMessage.set('');

    try {
      const result = await postApiV1AuthMagicLink({
        client,
        body: { email },
      });
      const status = result.response?.status;

      if (status === 429) {
        this.state.set('rate-limited');
        return;
      }

      if (status !== undefined && status >= 400) {
        this.state.set('error');
        this.errorMessage.set(
          'The sign in service is unavailable. Try again shortly.',
        );
        return;
      }

      this.state.set('sent');
    } catch {
      this.state.set('error');
      this.errorMessage.set(
        'The sign in service is unavailable. Try again shortly.',
      );
    }
  }

  reset(): void {
    this.state.set('idle');
    this.errorMessage.set('');
  }
}
