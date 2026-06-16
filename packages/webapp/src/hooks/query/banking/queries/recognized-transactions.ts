import {
  useInfiniteQuery,
  useQuery,
  UseQueryOptions,
  UseQueryResult,
  UseInfiniteQueryOptions,
  InfiniteData,
  QueryKey,
} from '@tanstack/react-query';
import {
  fetchExcludedBankTransactions,
  fetchRecognizedTransaction,
  fetchRecognizedTransactions,
} from '@bigcapital/sdk-ts';
import type {
  BankTransactionsListPage,
  ExcludedBankTransactionsListPage,
} from '@bigcapital/sdk-ts';
import { useApiFetcher } from '../../../useRequest';
import { bankingKeys } from '../query-keys';
import {
  getNextPageFromPagination,
  getPrevPageFromPagination,
} from '../../utils/infinite-pagination';

export function useGetRecognizedBankTransaction(
  uncategorizedTransactionId: number,
  options?: UseQueryOptions<unknown, Error>,
): UseQueryResult<unknown, Error> {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });

  return useQuery({
    ...options,
    queryKey: bankingKeys.recognizedTransaction(uncategorizedTransactionId),
    queryFn: () =>
      fetchRecognizedTransaction(fetcher, uncategorizedTransactionId),
  });
}

export function useRecognizedBankTransactionsInfinity(
  query: Record<string, unknown>,
  infinityProps?: Omit<
    UseInfiniteQueryOptions<
      BankTransactionsListPage,
      Error,
      InfiniteData<BankTransactionsListPage, number>,
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
    BankTransactionsListPage,
    Error,
    InfiniteData<BankTransactionsListPage, number>,
    QueryKey,
    number
  >({
    ...infinityProps,
    queryKey: bankingKeys.recognizedTransactionsInfinity(query),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      fetchRecognizedTransactions(fetcher, { page: pageParam, ...query }),
    getPreviousPageParam: getPrevPageFromPagination,
    getNextPageParam: getNextPageFromPagination,
  });
}

export function useExcludedBankTransactionsInfinity(
  query: Record<string, unknown>,
  infinityProps?: Omit<
    UseInfiniteQueryOptions<
      ExcludedBankTransactionsListPage,
      Error,
      InfiniteData<ExcludedBankTransactionsListPage, number>,
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
    ExcludedBankTransactionsListPage,
    Error,
    InfiniteData<ExcludedBankTransactionsListPage, number>,
    QueryKey,
    number
  >({
    ...infinityProps,
    queryKey: bankingKeys.excludedTransactionsInfinity(query),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      fetchExcludedBankTransactions(fetcher, { page: pageParam, ...query }),
    getPreviousPageParam: getPrevPageFromPagination,
    getNextPageParam: getNextPageFromPagination,
  });
}
