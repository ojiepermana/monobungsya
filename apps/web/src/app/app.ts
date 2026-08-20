import { DecimalPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { client, getHealth } from '#project/angular-sdk';
import { WEB_API_URL } from './runtime-config';

type GatewayState = 'checking' | 'online' | 'offline';

@Component({
  imports: [DecimalPipe, RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly gatewayState = signal<GatewayState>('checking');
  protected readonly gatewayService = signal('api-gateway');
  protected readonly authSurface = signal(false);

  private readonly router = inject(Router);

  constructor() {
    client.setConfig({
      baseUrl: WEB_API_URL,
      credentials: 'include',
    });
    this.authSurface.set(this.router.url.startsWith('/auth/'));
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.authSurface.set(event.urlAfterRedirects.startsWith('/auth/'));
      }
    });
    void this.loadGatewayHealth();
  }

  private async loadGatewayHealth(): Promise<void> {
    try {
      const result = await getHealth({ client });

      if (result.data?.status === 'ok') {
        this.gatewayState.set('online');
        this.gatewayService.set(result.data.service);
        return;
      }
    } catch {
      this.gatewayState.set('offline');
      return;
    }

    this.gatewayState.set('offline');
  }
}
