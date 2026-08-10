/** Pagination metadata as returned by list endpoints. */
export interface PagingInfo {
  pageNumber?: number;
  pageSize?: number;
  numberOfElements?: number;
  numberOfPages?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
}

/** A single page of results. */
export interface Page<T> {
  items: T[];
  /** False when the API omitted the list result instead of returning an empty list. */
  resultPresent?: boolean;
  pagination?: PagingInfo;
}

export interface PageParams {
  page?: number;
  size?: number;
}

/**
 * Walks page/size pagination until `hasNextPage` is false (or a short page
 * arrives, when the API omits pagination metadata), yielding individual items.
 */
export async function* iteratePages<T>(
  fetchPage: (params: PageParams) => Promise<Page<T>>,
  params: PageParams = {},
): AsyncGenerator<T, void, undefined> {
  let page = params.page ?? 1;
  const size = params.size ?? 20;
  for (;;) {
    const result = await fetchPage({ page, size });
    if (result.resultPresent === false) return;
    for (const item of result.items) yield item;
    const hasNext =
      result.pagination?.hasNextPage ?? result.items.length === size;
    if (!hasNext || result.items.length === 0) return;
    page += 1;
  }
}
