import { TestBed } from '@angular/core/testing';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationStart,
  Router,
} from '@angular/router';
import { Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { NavigationCorrelationService } from './navigation-correlation.service';

describe('NavigationCorrelationService', () => {
  it('uses one pending trace for guards and promotes it after navigation', () => {
    const events = new Subject<
      NavigationStart | NavigationEnd | NavigationCancel
    >();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        NavigationCorrelationService,
        { provide: Router, useValue: { events } },
      ],
    });

    const service = TestBed.inject(NavigationCorrelationService);
    events.next(new NavigationStart(1, '/users?search=jane'));
    const pending = service.current();

    expect(pending?.clientRoute).toBe('/users');
    expect(pending?.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    events.next(new NavigationEnd(1, '/users?search=jane', '/users'));
    expect(service.current()).toEqual(pending);

    events.next(new NavigationStart(2, '/logs/access'));
    events.next(new NavigationCancel(2, '/logs/access', 'cancelled'));
    expect(service.current()).toEqual(pending);
  });
});
