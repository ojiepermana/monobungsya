import { describe, expect, it } from 'vitest';
import { TauriService } from './tauri.service';

describe('TauriService', () => {
  it('builds the desktop auth deep link without putting the raw token in path segments', () => {
    const service = new TauriService();

    expect(service.desktopAuthUrl('token with spaces')).toBe('monobungsya://auth?token=token+with+spaces');
  });

  it('does not request desktop magic-link behavior in a normal browser runtime', () => {
    const service = new TauriService();

    expect(service.isAvailable()).toBe(false);
    expect(service.magicLinkOptions()).toEqual({});
  });
});
