import type { ActivatedRoute, Router } from '@angular/router';

export function pageFromQuery(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function syncPageQuery(
  router: Router,
  route: ActivatedRoute,
  page: number,
  parameter = 'page',
): void {
  void router.navigate([], {
    relativeTo: route,
    replaceUrl: true,
    queryParams: { [parameter]: page > 1 ? page : null },
    queryParamsHandling: 'merge',
  });
}
