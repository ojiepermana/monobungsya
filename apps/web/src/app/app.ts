import { DecimalPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { BadgeComponent } from '@ojiepermana/angular/component/badge';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { CardComponent } from '@ojiepermana/angular/component/card';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import { SeparatorComponent } from '@ojiepermana/angular/component/separator';
import {
  NavigationContainerComponent,
  NavigationContentComponent,
  NavigationFlyoutComponent,
  NavigationFooterComponent,
  NavigationHeaderComponent,
  NavigationSidebarComponent,
} from '@ojiepermana/angular/navigation';
import type { NavigationItem } from '@ojiepermana/angular/navigation/types';
import { ThemeSettingsComponent } from '@ojiepermana/angular/theme/component/settings';
import {
  LayoutComponent,
  LayoutContentComponent,
  LayoutNavigationComponent,
  LayoutVerticalComponent,
} from '@ojiepermana/angular/theme/layout';
import { PageComponent } from '@ojiepermana/angular/theme/page/root';
import {
  PageDashboardComponent,
  PageFooterComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page/slots';
import { ShellComponent } from '@ojiepermana/angular/theme/shell';
import { client, getApiV1AuthSession, getHealth } from '#project/angular-sdk';
import { WEB_API_URL } from './runtime-config';

type GatewayState = 'checking' | 'online' | 'offline';
type SessionState = 'checking' | 'authenticated' | 'unauthenticated' | 'error';

interface SessionResponse {
  authenticated: boolean;
  user?: {
    name?: string;
    role?: string;
  };
}

function isSessionResponse(value: unknown): value is SessionResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'authenticated' in value &&
    typeof value.authenticated === 'boolean'
  );
}

@Component({
  imports: [
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    DecimalPipe,
    IconComponent,
    LayoutComponent,
    LayoutContentComponent,
    LayoutNavigationComponent,
    LayoutVerticalComponent,
    NavigationContainerComponent,
    NavigationContentComponent,
    NavigationFooterComponent,
    NavigationFlyoutComponent,
    NavigationHeaderComponent,
    NavigationSidebarComponent,
    PageComponent,
    PageDashboardComponent,
    PageFooterComponent,
    PageHeaderComponent,
    RouterOutlet,
    SeparatorComponent,
    ShellComponent,
    ThemeSettingsComponent,
  ],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly gatewayState = signal<GatewayState>('checking');
  protected readonly gatewayService = signal('api-gateway');
  protected readonly authSurface = signal(false);
  protected readonly sessionState = signal<SessionState>('checking');
  protected readonly sessionUserName = signal('');
  protected readonly sessionUserRole = signal('');
  protected readonly themeSettingsOpen = signal(false);
  protected readonly navigationItems: readonly NavigationItem[] = [
    {
      id: 'overview',
      title: 'Workspace overview',
      subtitle: 'Gateway and service boundaries',
      icon: 'dashboard',
      link: '/',
      exactMatch: true,
    },
  ];

  private readonly router = inject(Router);

  constructor() {
    client.setConfig({
      baseUrl: WEB_API_URL,
      credentials: 'include',
    });
    this.authSurface.set(this.router.url.startsWith('/auth/'));
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        const isAuthRoute = event.urlAfterRedirects.startsWith('/auth/');
        this.authSurface.set(isAuthRoute);

        if (!isAuthRoute) {
          void this.loadSession();
        }
      }
    });

    if (!this.authSurface()) {
      void this.loadSession();
    }
  }

  protected retrySession(): void {
    void this.loadSession();
  }

  private async loadSession(): Promise<void> {
    this.sessionState.set('checking');

    try {
      const result = await getApiV1AuthSession({ client });

      if ((result.response?.status ?? 200) >= 500) {
        this.sessionState.set('error');
        return;
      }

      if (!isSessionResponse(result.data)) {
        this.sessionState.set('error');
        return;
      }

      if (!result.data.authenticated) {
        this.sessionState.set('unauthenticated');
        void this.router.navigateByUrl('/auth/login').catch(() => undefined);
        return;
      }

      this.sessionUserName.set(result.data.user?.name ?? '');
      this.sessionUserRole.set(result.data.user?.role ?? '');
      this.sessionState.set('authenticated');
      void this.loadGatewayHealth();
    } catch {
      this.sessionState.set('error');
    }
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
