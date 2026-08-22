import { InjectionToken, type Provider } from '@angular/core';

export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');

export function provideApiConfiguration(apiUrl: string): Provider {
  return {
    provide: API_BASE_URL,
    useValue: apiUrl,
  };
}
