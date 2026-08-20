import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideUiTheme } from '@ojiepermana/angular/theme/styles';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideUiTheme({
      mode: 'system',
      color: 'brand',
      neutral: 'base',
      radius: 'xs',
      space: 'compact',
      brand: {
        color: '177 72% 28%',
        foreground: '0 0% 100%',
      },
    }),
  ],
};
