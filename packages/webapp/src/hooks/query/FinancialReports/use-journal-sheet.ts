import {
  useQuery,
  useMutation,
  UseQueryOptions,
  UseMutationOptions,
} from '@tanstack/react-query';
import {
  fetchJournalTable,
  fetchJournalXlsx,
  fetchJournalCsv,
  fetchJournalPdf,
} from '@bigcapital/sdk-ts';
import type {
  JournalTableQuery,
  JournalTableResponse,
  JournalXlsxQuery,
  JournalCsvQuery,
  JournalPdfQuery,
} from '@bigcapital/sdk-ts';
import { useApiFetcher } from '../../useRequest';
import { useFetcherPdf } from '../../useRequestPdf';
import { downloadFile } from '../../useDownloadFile';
import { financialReportsKeys } from './query-keys';

export function useJournalSheet(
  query: JournalTableQuery,
  props?: Omit<
    UseQueryOptions<JournalTableResponse, Error>,
    'queryKey' | 'queryFn'
  >,
) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    ...props,
    queryKey: financialReportsKeys.journal(query),
    queryFn: () => fetchJournalTable(fetcher, query),
  });
}

export function useJournalSheetXlsxExport(
  query: JournalXlsxQuery,
  args?: Omit<UseMutationOptions<void, Error, void>, 'mutationFn'>,
) {
  const fetcher = useApiFetcher();
  return useMutation({
    ...args,
    mutationFn: () =>
      fetchJournalXlsx(fetcher, query).then((blob) =>
        downloadFile(blob, 'journal.xlsx'),
      ),
  });
}

export function useJournalSheetCsvExport(
  query: JournalCsvQuery,
  args?: Omit<UseMutationOptions<void, Error, void>, 'mutationFn'>,
) {
  const fetcher = useApiFetcher();
  return useMutation({
    ...args,
    mutationFn: () =>
      fetchJournalCsv(fetcher, query).then((blob) =>
        downloadFile(blob, 'journal.csv'),
      ),
  });
}

export function useJournalSheetPdf(query: JournalPdfQuery) {
  const fetcher = useApiFetcher();
  return useFetcherPdf(() => fetchJournalPdf(fetcher, query));
}
