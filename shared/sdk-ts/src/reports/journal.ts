import type { OpArgType } from 'openapi-typescript-fetch';
import type { ApiFetcher } from '../fetch-utils';
import type { paths } from '../schema';
import {
  OpForPath,
  OpQueryParams,
  OpResponseBody,
  OpResponseBodyTable,
} from '../utils';

export const JOURNAL_ROUTE = '/api/reports/journal' as const satisfies keyof paths;

type Op = OpForPath<typeof JOURNAL_ROUTE, 'get'>;
type Arg = OpArgType<Op>;

// Table format (existing functionality)
export type JournalTableQuery = OpQueryParams<Op>;
export type JournalTableResponse = OpResponseBodyTable<Op>;

export async function fetchJournalTable(
  fetcher: ApiFetcher,
  query: JournalTableQuery
): Promise<JournalTableResponse> {
  const get = fetcher.path(JOURNAL_ROUTE).method('get').create();
  const { data } = await get(query as Arg);
  return data as unknown as JournalTableResponse;
}

// JSON format - Note: may only have table format in schema
// Using type assertion for JSON format compatibility
export type JournalJsonQuery = OpQueryParams<Op>;
export type JournalJsonResponse = OpResponseBody<Op>;

export async function fetchJournalJson(
  fetcher: ApiFetcher,
  query: JournalJsonQuery
): Promise<JournalJsonResponse> {
  const get = fetcher.path(JOURNAL_ROUTE).method('get').create();
  const { data } = await get(query as Arg);
  return data as unknown as JournalJsonResponse;
}

// CSV format (returns Blob)
export type JournalCsvQuery = OpQueryParams<Op>;
export type JournalCsvResponse = Blob;

export async function fetchJournalCsv(
  fetcher: ApiFetcher,
  query: JournalCsvQuery
): Promise<JournalCsvResponse> {
  const get = fetcher.path(JOURNAL_ROUTE).method('get').create();
  const response = await get({ ...query, Accept: 'application/csv' } as Arg);
  return response.data as unknown as JournalCsvResponse;
}

// XLSX format (returns Blob)
export type JournalXlsxQuery = OpQueryParams<Op>;
export type JournalXlsxResponse = Blob;

export async function fetchJournalXlsx(
  fetcher: ApiFetcher,
  query: JournalXlsxQuery
): Promise<JournalXlsxResponse> {
  const get = fetcher.path(JOURNAL_ROUTE).method('get').create();
  const response = await get({ ...query, Accept: 'application/xlsx' } as Arg);
  return response.data as unknown as JournalXlsxResponse;
}

// PDF format (returns Blob)
export type JournalPdfQuery = OpQueryParams<Op>;
export type JournalPdfResponse = Blob;

export async function fetchJournalPdf(
  fetcher: ApiFetcher,
  query: JournalPdfQuery
): Promise<JournalPdfResponse> {
  const get = fetcher.path(JOURNAL_ROUTE).method('get').create();
  const response = await get({ ...query, Accept: 'application/pdf' } as Arg);
  return response.data as unknown as JournalPdfResponse;
}
