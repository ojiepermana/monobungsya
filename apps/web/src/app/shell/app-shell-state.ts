import type { LayoutType } from '@ojiepermana/angular/theme/layout/types';

const NAVIGATION_HIDING_LAYOUT_TYPES = new Set<LayoutType>(['empty', 'fluid']);
type NavigationLayoutType = Exclude<LayoutType, 'empty' | 'fluid'>;

/**
 * The authenticated application shell must always keep its primary navigation
 * reachable. The library intentionally hides LayoutNavigation for `empty` and
 * `fluid`, so those page-oriented layout modes are normalized to the app's
 * visible shell fallback.
 */
export function resolveNavigationLayoutType(
  layoutType: LayoutType,
  fallback: NavigationLayoutType,
): NavigationLayoutType {
  return NAVIGATION_HIDING_LAYOUT_TYPES.has(layoutType)
    ? fallback
    : (layoutType as NavigationLayoutType);
}
