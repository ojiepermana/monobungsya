import { describe, expect, it } from 'vitest';
import { resolveNavigationLayoutType } from './app-shell-state';

describe('application shell navigation layout', () => {
  it('keeps navigation-visible layout types unchanged', () => {
    expect(resolveNavigationLayoutType('vertical', 'vertical')).toBe('vertical');
    expect(resolveNavigationLayoutType('horizontal', 'vertical')).toBe('horizontal');
  });

  it('replaces empty and fluid layouts with the navigation-visible fallback', () => {
    expect(resolveNavigationLayoutType('empty', 'vertical')).toBe('vertical');
    expect(resolveNavigationLayoutType('fluid', 'vertical')).toBe('vertical');
    expect(resolveNavigationLayoutType('empty', 'horizontal')).toBe('horizontal');
  });
});
