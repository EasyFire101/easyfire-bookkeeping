import { useQuery, useMutation, UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';
import {
  fetchReceivableAgingTable,
  fetchReceivableAgingXlsx,
  fetchReceivableAgingCsv,
  fetchReceivableAgingPdf,
} from '@bigcapital/sdk-ts';
import type {
  ReceivableAgingTableQuery,
  ReceivableAgingTableResponse,
  ReceivableAgingXlsxQuery,
  ReceivableAgingCsvQuery,
  ReceivableAgingPdfQuery,
} from '@bigcapital/sdk-ts';
import { useApiFetcher } from '../../useRequest';
import { useFetcherPdf } from '../../useRequestPdf';
import { downloadFile } from '../../useDownloadFile';
import { financialReportsKeys } from './query-keys';

export function useARAgingSummaryReport(
  query: ReceivableAgingTableQuery,
  props?: Omit<UseQueryOptions<ReceivableAgingTableResponse, Error>, 'queryKey' | 'queryFn'>,
) {
  const fetcher = useApiFetcher();
  return useQuery({
    ...props,
    queryKey: financialReportsKeys.arAgingSummary(query),
    queryFn: () => fetchReceivableAgingTable(fetcher, query),
  });
}

export function useARAgingSheetXlsxExport(
  query: ReceivableAgingXlsxQuery,
  args?: Omit<UseMutationOptions<void, Error, void>, 'mutationFn'>,
) {
  const fetcher = useApiFetcher();
  return useMutation({
    ...args,
    mutationFn: () =>
      fetchReceivableAgingXlsx(fetcher, query).then((blob) =>
        downloadFile(blob, 'receivable_aging_summary.xlsx'),
      ),
  });
}

export function useARAgingSheetCsvExport(
  query: ReceivableAgingCsvQuery,
  args?: Omit<UseMutationOptions<void, Error, void>, 'mutationFn'>,
) {
  const fetcher = useApiFetcher();
  return useMutation({
    ...args,
    mutationFn: () =>
      fetchReceivableAgingCsv(fetcher, query).then((blob) =>
        downloadFile(blob, 'receivable_aging_summary.csv'),
      ),
  });
}

export function useARAgingSummaryPdf(query: ReceivableAgingPdfQuery) {
  const fetcher = useApiFetcher();
  return useFetcherPdf(() => fetchReceivableAgingPdf(fetcher, query));
}
