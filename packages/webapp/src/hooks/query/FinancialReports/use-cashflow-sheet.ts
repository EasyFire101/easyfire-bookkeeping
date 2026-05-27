import { useQuery, useMutation, UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';
import {
  fetchCashflowStatementTable,
  fetchCashflowStatementXlsx,
  fetchCashflowStatementCsv,
  fetchCashflowStatementPdf,
} from '@bigcapital/sdk-ts';
import type {
  CashflowStatementTableQuery,
  CashflowStatementTableResponse,
  CashflowStatementXlsxQuery,
  CashflowStatementCsvQuery,
  CashflowStatementPdfQuery,
} from '@bigcapital/sdk-ts';
import { useApiFetcher } from '../../useRequest';
import { useFetcherPdf } from '../../useRequestPdf';
import { downloadFile } from '../../useDownloadFile';
import { financialReportsKeys } from './query-keys';

interface CashFlowStatementReport {
  columns: CashflowStatementTableResponse['table']['columns'];
  query: CashflowStatementTableResponse['query'];
  meta: CashflowStatementTableResponse['meta'];
  tableRows: CashflowStatementTableResponse['table']['rows'];
}

export function useCashFlowStatementReport(
  query: CashflowStatementTableQuery,
  props?: Omit<UseQueryOptions<CashFlowStatementReport, Error>, 'queryKey' | 'queryFn'>,
) {
  const fetcher = useApiFetcher();
  return useQuery({
    ...props,
    queryKey: financialReportsKeys.cashFlowStatement(query),
    queryFn: () =>
      fetchCashflowStatementTable(fetcher, query).then((data) => ({
        columns: data.table.columns,
        query: data.query,
        meta: data.meta,
        tableRows: data.table.rows,
      })),
  });
}

export function useCashFlowStatementXlsxExport(
  query: CashflowStatementXlsxQuery,
  args?: Omit<UseMutationOptions<void, Error, void>, 'mutationFn'>,
) {
  const fetcher = useApiFetcher();
  return useMutation({
    ...args,
    mutationFn: () =>
      fetchCashflowStatementXlsx(fetcher, query).then((blob) =>
        downloadFile(blob, 'cashflow_statement.xlsx'),
      ),
  });
}

export function useCashFlowStatementCsvExport(
  query: CashflowStatementCsvQuery,
  args?: Omit<UseMutationOptions<void, Error, void>, 'mutationFn'>,
) {
  const fetcher = useApiFetcher();
  return useMutation({
    ...args,
    mutationFn: () =>
      fetchCashflowStatementCsv(fetcher, query).then((blob) =>
        downloadFile(blob, 'cashflow_statement.csv'),
      ),
  });
}

export function useCashflowSheetPdf(query: CashflowStatementPdfQuery) {
  const fetcher = useApiFetcher();
  return useFetcherPdf(() => fetchCashflowStatementPdf(fetcher, query));
}
