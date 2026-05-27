import { useQuery, useMutation, UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';
import {
  fetchCustomerBalanceTable,
  fetchCustomerBalanceXlsx,
  fetchCustomerBalanceCsv,
  fetchCustomerBalancePdf,
} from '@bigcapital/sdk-ts';
import type {
  CustomerBalanceTableQuery,
  CustomerBalanceTableResponse,
  CustomerBalanceXlsxQuery,
  CustomerBalanceCsvQuery,
  CustomerBalancePdfQuery,
} from '@bigcapital/sdk-ts';
import { useApiFetcher } from '../../useRequest';
import { useFetcherPdf } from '../../useRequestPdf';
import { downloadFile } from '../../useDownloadFile';
import { financialReportsKeys } from './query-keys';

export function useCustomerBalanceSummaryReport(
  query: CustomerBalanceTableQuery,
  props?: Omit<UseQueryOptions<CustomerBalanceTableResponse, Error>, 'queryKey' | 'queryFn'>,
) {
  const fetcher = useApiFetcher();
  return useQuery({
    ...props,
    queryKey: financialReportsKeys.customerBalanceSummary(query),
    queryFn: () => fetchCustomerBalanceTable(fetcher, query),
  });
}

export function useCustomerBalanceSummaryXlsxExport(
  query: CustomerBalanceXlsxQuery,
  args?: Omit<UseMutationOptions<void, Error, void>, 'mutationFn'>,
) {
  const fetcher = useApiFetcher();
  return useMutation({
    ...args,
    mutationFn: () =>
      fetchCustomerBalanceXlsx(fetcher, query).then((blob) =>
        downloadFile(blob, 'customer_balance_summary.xlsx'),
      ),
  });
}

export function useCustomerBalanceSummaryCsvExport(
  query: CustomerBalanceCsvQuery,
  args?: Omit<UseMutationOptions<void, Error, void>, 'mutationFn'>,
) {
  const fetcher = useApiFetcher();
  return useMutation({
    ...args,
    mutationFn: () =>
      fetchCustomerBalanceCsv(fetcher, query).then((blob) =>
        downloadFile(blob, 'customer_balance_summary.csv'),
      ),
  });
}

export function useCustomerBalanceSummaryPdf(query: CustomerBalancePdfQuery) {
  const fetcher = useApiFetcher();
  return useFetcherPdf(() => fetchCustomerBalancePdf(fetcher, query));
}
