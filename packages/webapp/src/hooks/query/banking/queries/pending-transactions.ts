import {
  useInfiniteQuery,
  UseQueryOptions,
  UseQueryResult,
  useQuery,
  UseInfiniteQueryOptions,
  InfiniteData,
  QueryKey,
} from '@tanstack/react-query';
import { fetchPendingTransactions } from '@bigcapital/sdk-ts';
import type { PendingBankTransactionsListPage } from '@bigcapital/sdk-ts';
import { useApiFetcher } from '../../../useRequest';
import { bankingKeys } from '../query-keys';
import {
  getNextPageFromPagination,
  getPrevPageFromPagination,
} from '../../utils/infinite-pagination';

export type PendingBankAccountTransactionsResponse = Awaited<
  ReturnType<typeof fetchPendingTransactions>
>;

export function usePendingBankAccountTransactions(
  options?: UseQueryOptions<PendingBankAccountTransactionsResponse, Error>,
): UseQueryResult<PendingBankAccountTransactionsResponse, Error> {
  const fetcher = useApiFetcher();

  return useQuery({
    queryKey: bankingKeys.pendingTransactions(),
    queryFn: () => fetchPendingTransactions(fetcher),
    ...options,
  });
}

export function usePendingBankTransactionsInfinity(
  query: Record<string, unknown>,
  infinityProps?: Omit<
    UseInfiniteQueryOptions<
      PendingBankTransactionsListPage,
      Error,
      InfiniteData<PendingBankTransactionsListPage, number>,
      QueryKey,
      number
    >,
    | 'queryKey'
    | 'queryFn'
    | 'initialPageParam'
    | 'getNextPageParam'
    | 'getPreviousPageParam'
  >,
) {
  const fetcher = useApiFetcher();

  return useInfiniteQuery<
    PendingBankTransactionsListPage,
    Error,
    InfiniteData<PendingBankTransactionsListPage, number>,
    QueryKey,
    number
  >({
    ...infinityProps,
    queryKey: bankingKeys.pendingTransactionsInfinity(query),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      fetchPendingTransactions(fetcher, { page: pageParam, ...query }),
    getPreviousPageParam: getPrevPageFromPagination,
    getNextPageParam: getNextPageFromPagination,
  });
}
