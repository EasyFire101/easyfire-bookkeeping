import type { OpArgType } from 'openapi-typescript-fetch';
import type { ApiFetcher } from '../fetch-utils';
import type { paths } from '../schema';
import {
  OpForPath,
  OpQueryParams,
  OpResponseBody,
  OpResponseBodyTable,
} from '../utils';

export const BALANCE_SHEET_ROUTE = '/api/reports/balance-sheet' as const satisfies keyof paths;

type Op = OpForPath<typeof BALANCE_SHEET_ROUTE, 'get'>;
type Arg = OpArgType<Op>;

// Table format (existing functionality)
export type BalanceSheetTableQuery = OpQueryParams<Op>;
export type BalanceSheetTableResponse = OpResponseBodyTable<Op>;

export async function fetchBalanceSheetTable(
  fetcher: ApiFetcher,
  query: BalanceSheetTableQuery
): Promise<BalanceSheetTableResponse> {
  const get = fetcher.path(BALANCE_SHEET_ROUTE).method('get').create();
  const { data } = await get(query as Arg);
  return data as unknown as BalanceSheetTableResponse;
}

// JSON format - Note: BalanceSheet only has table format in schema
// Using type assertion for JSON format compatibility
export type BalanceSheetJsonQuery = OpQueryParams<Op>;
export type BalanceSheetJsonResponse = OpResponseBody<Op>;

export async function fetchBalanceSheetJson(
  fetcher: ApiFetcher,
  query: BalanceSheetJsonQuery
): Promise<BalanceSheetJsonResponse> {
  const get = fetcher.path(BALANCE_SHEET_ROUTE).method('get').create();
  const { data } = await get(query as Arg);
  return data as unknown as BalanceSheetJsonResponse;
}

// CSV format (returns Blob)
export type BalanceSheetCsvQuery = OpQueryParams<Op>;
export type BalanceSheetCsvResponse = Blob;

export async function fetchBalanceSheetCsv(
  fetcher: ApiFetcher,
  query: BalanceSheetCsvQuery
): Promise<BalanceSheetCsvResponse> {
  const get = fetcher.path(BALANCE_SHEET_ROUTE).method('get').create();
  const response = await get({ ...query, Accept: 'application/csv' } as Arg);
  return response.data as unknown as BalanceSheetCsvResponse;
}

// XLSX format (returns Blob)
export type BalanceSheetXlsxQuery = OpQueryParams<Op>;
export type BalanceSheetXlsxResponse = Blob;

export async function fetchBalanceSheetXlsx(
  fetcher: ApiFetcher,
  query: BalanceSheetXlsxQuery
): Promise<BalanceSheetXlsxResponse> {
  const get = fetcher.path(BALANCE_SHEET_ROUTE).method('get').create();
  const response = await get({ ...query, Accept: 'application/xlsx' } as Arg);
  return response.data as unknown as BalanceSheetXlsxResponse;
}

// PDF format (returns Blob)
export type BalanceSheetPdfQuery = OpQueryParams<Op>;
export type BalanceSheetPdfResponse = Blob;

export async function fetchBalanceSheetPdf(
  fetcher: ApiFetcher,
  query: BalanceSheetPdfQuery
): Promise<BalanceSheetPdfResponse> {
  const get = fetcher.path(BALANCE_SHEET_ROUTE).method('get').create();
  const response = await get({ ...query, Accept: 'application/pdf' } as Arg);
  return response.data as unknown as BalanceSheetPdfResponse;
}
