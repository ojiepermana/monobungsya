import type { Routes } from '@angular/router';
import { AuthCallback } from './auth/auth-callback';
import { AuthLogin } from './auth/auth-login';

export const routes: Routes = [
  { path: 'auth/login', component: AuthLogin },
  {
    path: 'auth/callback-complete',
    component: AuthCallback,
    data: { mode: 'complete' },
  },
  {
    path: 'auth/callback-error',
    component: AuthCallback,
    data: { mode: 'error' },
  },
];
