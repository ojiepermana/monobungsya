import { describe, expect, it } from 'bun:test';
import {
  normalizeClientCorrelation,
  normalizeClientRoute,
} from './request-id.plugin';

describe('request context validation', () => {
  it('accepts a safe client correlation value', () => {
    expect(
      normalizeClientCorrelation('navigation-1:users', 'request-1'),
    ).toEqual({
      value: 'navigation-1:users',
      source: 'client_header',
    });
  });

  it('falls back to the server request id for unsafe correlation values', () => {
    expect(normalizeClientCorrelation('navigation value', 'request-1')).toEqual(
      {
        value: 'request-1',
        source: 'request_id',
      },
    );
  });

  it('strips client route query and fragment values and normalizes ids', () => {
    expect(
      normalizeClientRoute(
        '/users/0198f8a0-0000-7000-8000-000000000001?token=secret#fragment',
      ),
    ).toBe('/users/:id');
  });

  it('rejects non pathname client route values and oversized stored paths', () => {
    expect(normalizeClientRoute('https://evil.example/users')).toBeNull();
    expect(normalizeClientRoute(`/${'x'.repeat(256)}`)).toBeNull();
  });
});
