import { LOGS_PER_PAGE, type LogsRepository } from './logs.repository';
import type { AuditTrailsResult, LogsMeta } from './logs.types';

/** Collapse repeated whitespace and trim, so filters match stored values. */
function squish(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Parse the page query param into a positive integer, defaulting to 1. */
function parsePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function buildMeta(page: number, total: number): LogsMeta {
  return {
    page,
    perPage: LOGS_PER_PAGE,
    total,
    totalPages: Math.ceil(total / LOGS_PER_PAGE),
  };
}

/**
 * The actorUserId filter (spec docs/specs/0007-user-management, AC-10) is
 * deliberately not echoed back in `filters`: it narrows a list to one user for
 * the user detail page rather than being one of the viewer's own filter
 * controls, so the response contract the log viewer pages read stays unchanged.
 */
export class LogsService {
  constructor(private readonly repository: LogsRepository) {}

  async getAuditTrails(query: {
    search?: string;
    module?: string;
    action?: string;
    actorUserId?: string;
    page?: string;
  }): Promise<AuditTrailsResult> {
    const filters = {
      search: squish(query.search),
      module: squish(query.module),
      action: squish(query.action),
    };
    const page = parsePage(query.page);
    const { items, total } = await this.repository.listAuditTrails({
      ...filters,
      actorUserId: squish(query.actorUserId),
      page,
    });

    return {
      data: items,
      meta: buildMeta(page, total),
      filters,
      options: await this.repository.auditTrailOptions(),
    };
  }
}
