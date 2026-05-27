import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { fetchTransactionsByReferenceJson } from '@bigcapital/sdk-ts';
import type {
  TransactionsByReferenceJsonQuery,
  TransactionsByReferenceJsonResponse,
} from '@bigcapital/sdk-ts';
import { useApiFetcher } from '../../useRequest';
import { financialReportsKeys } from './query-keys';

export function useTransactionsByReference(
  query: TransactionsByReferenceJsonQuery,
  props?: Omit<UseQueryOptions<TransactionsByReferenceJsonResponse, Error>, 'queryKey' | 'queryFn'>,
) {
  const fetcher = useApiFetcher();
  return useQuery({
    ...props,
    queryKey: financialReportsKeys.transactionsByReference(query),
    queryFn: () => fetchTransactionsByReferenceJson(fetcher, query),
  });
}
