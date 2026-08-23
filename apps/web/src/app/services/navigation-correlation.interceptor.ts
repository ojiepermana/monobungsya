import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { NavigationCorrelationService } from './navigation-correlation.service';

export const navigationCorrelationInterceptor: HttpInterceptorFn = (
  request,
  next,
) => {
  const navigation = inject(NavigationCorrelationService).current();
  if (!navigation || !isGatewayRequest(request.urlWithParams)) {
    return next(request);
  }

  return next(
    request.clone({
      setHeaders: {
        'x-correlation-id': navigation.traceId,
        'x-client-route': navigation.clientRoute,
      },
    }),
  );
};

function isGatewayRequest(url: string): boolean {
  const origin = globalThis.location?.origin ?? 'http://localhost';
  const gatewayOrigin = new URL(environment.apiUrl || origin, origin).origin;
  return new URL(url, origin).origin === gatewayOrigin;
}
