export type PaginatedResult<T> = {
  items: T[];
  page: number;
  pageCount: number;
};

/** Pagination pure et bornée, partagée par les listes du dashboard exécutif. */
export function paginateDashboardItems<T>(
  items: T[],
  requestedPage: number,
  pageSize: number
): PaginatedResult<T> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const page = Math.min(Math.max(0, Math.floor(requestedPage)), pageCount - 1);
  return {
    items: items.slice(page * safePageSize, (page + 1) * safePageSize),
    page,
    pageCount,
  };
}
