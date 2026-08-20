import { DecimalPipe } from '@angular/common';
import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { client, getHealth } from '#project/angular-sdk';

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

  constructor() {
    client.setConfig({ baseUrl: 'http://localhost:3000' });
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
