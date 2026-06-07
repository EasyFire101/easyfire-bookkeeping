import {
  useQuery,
  useMutation,
  UseQueryOptions,
  UseMutationOptions,
} from '@tanstack/react-query';
import {
  fetchTransactionsByVendorsTable,
  fetchTransactionsByVendorsXlsx,
  fetchTransactionsByVendorsCsv,
  fetchTransactionsByVendorsPdf,
} from '@bigcapital/sdk-ts';
import type {
  TransactionsByVendorsTableQuery,
  TransactionsByVendorsTableResponse,
  TransactionsByVendorsXlsxQuery,
  TransactionsByVendorsCsvQuery,
  TransactionsByVendorsPdfQuery,
} from '@bigcapital/sdk-ts';
import { useApiFetcher } from '../../useRequest';
import { useFetcherPdf } from '../../useRequestPdf';
import { downloadFile } from '../../useDownloadFile';
import { financialReportsKeys } from './query-keys';

export function useVendorsTransactionsReport(
  query: TransactionsByVendorsTableQuery,
  props?: Omit<
    UseQueryOptions<TransactionsByVendorsTableResponse, Error>,
    'queryKey' | 'queryFn'
  >,
) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    ...props,
    queryKey: financialReportsKeys.vendorTransactions(query),
    queryFn: () => fetchTransactionsByVendorsTable(fetcher, query),
  });
}

export function useVendorsTransactionsXlsxExport(
  query: TransactionsByVendorsXlsxQuery,
  args?: Omit<UseMutationOptions<void, Error, void>, 'mutationFn'>,
) {
  const fetcher = useApiFetcher();
  return useMutation({
    ...args,
    mutationFn: () =>
      fetchTransactionsByVendorsXlsx(fetcher, query).then((blob) =>
        downloadFile(blob, 'transactions_by_vendor.xlsx'),
      ),
  });
}

export function useVendorsTransactionsCsvExport(
  query: TransactionsByVendorsCsvQuery,
  args?: Omit<UseMutationOptions<void, Error, void>, 'mutationFn'>,
) {
  const fetcher = useApiFetcher();
  return useMutation({
    ...args,
    mutationFn: () =>
      fetchTransactionsByVendorsCsv(fetcher, query).then((blob) =>
        downloadFile(blob, 'transactions_by_vendor.csv'),
      ),
  });
}

export function useTransactionsByVendorsPdf(
  query: TransactionsByVendorsPdfQuery,
) {
  const fetcher = useApiFetcher();
  return useFetcherPdf(() => fetchTransactionsByVendorsPdf(fetcher, query));
}
