import { describe, expect, it } from 'vitest';
import { APP_LAYOUT_DEFAULTS, APP_THEME_DEFAULTS } from './app.config';

describe('Angular UI package theme defaults', () => {
  it('covers AC-3 and AC-4: starts in system mode with the canonical brand tokens', () => {
    expect(APP_THEME_DEFAULTS).toEqual({
      mode: 'system',
      color: 'brand',
      neutral: 'base',
      radius: 'xs',
      space: 'compact',
      brand: {
        color: '177 72% 28%',
        foreground: '0 0% 100%',
      },
    });
  });

  it('covers AC-6 and AC-13: seeds a navigation-visible vertical layout', () => {
    expect(APP_LAYOUT_DEFAULTS).toEqual({
      surface: 'flat',
      appearance: 'flat',
      type: 'vertical',
      width: 'full',
    });
  });
});
