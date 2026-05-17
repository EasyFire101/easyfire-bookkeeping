import type { OpArgType } from 'openapi-typescript-fetch';
import type { ApiFetcher } from '../fetch-utils';
import type { paths } from '../schema';
import {
  OpForPath,
  OpQueryParams,
  OpResponseBody,
  OpResponseBodyTable,
} from '../utils';

export const INVENTORY_DETAILS_ROUTE = '/api/reports/inventory-item-details' as const satisfies keyof paths;

type Op = OpForPath<typeof INVENTORY_DETAILS_ROUTE, 'get'>;
type Arg = OpArgType<Op>;

// Table format (existing functionality)
export type InventoryItemDetailsTableQuery = OpQueryParams<Op>;
export type InventoryItemDetailsTableResponse = OpResponseBodyTable<Op>;

export async function fetchInventoryItemDetailsTable(
  fetcher: ApiFetcher,
  query: InventoryItemDetailsTableQuery
): Promise<InventoryItemDetailsTableResponse> {
  const get = fetcher.path(INVENTORY_DETAILS_ROUTE).method('get').create();
  const { data } = await get(query as Arg);
  return data as unknown as InventoryItemDetailsTableResponse;
}

// JSON format - Note: may only have table format in schema
// Using type assertion for JSON format compatibility
export type InventoryItemDetailsJsonQuery = OpQueryParams<Op>;
export type InventoryItemDetailsJsonResponse = OpResponseBody<Op>;

export async function fetchInventoryItemDetailsJson(
  fetcher: ApiFetcher,
  query: InventoryItemDetailsJsonQuery
): Promise<InventoryItemDetailsJsonResponse> {
  const get = fetcher.path(INVENTORY_DETAILS_ROUTE).method('get').create();
  const { data } = await get(query as Arg);
  return data as unknown as InventoryItemDetailsJsonResponse;
}

// CSV format (returns Blob)
export type InventoryItemDetailsCsvQuery = OpQueryParams<Op>;
export type InventoryItemDetailsCsvResponse = Blob;

export async function fetchInventoryItemDetailsCsv(
  fetcher: ApiFetcher,
  query: InventoryItemDetailsCsvQuery
): Promise<InventoryItemDetailsCsvResponse> {
  const get = fetcher.path(INVENTORY_DETAILS_ROUTE).method('get').create();
  const response = await get({ ...query, Accept: 'application/csv' } as Arg);
  return response.data as unknown as InventoryItemDetailsCsvResponse;
}

// XLSX format (returns Blob)
export type InventoryItemDetailsXlsxQuery = OpQueryParams<Op>;
export type InventoryItemDetailsXlsxResponse = Blob;

export async function fetchInventoryItemDetailsXlsx(
  fetcher: ApiFetcher,
  query: InventoryItemDetailsXlsxQuery
): Promise<InventoryItemDetailsXlsxResponse> {
  const get = fetcher.path(INVENTORY_DETAILS_ROUTE).method('get').create();
  const response = await get({ ...query, Accept: 'application/xlsx' } as Arg);
  return response.data as unknown as InventoryItemDetailsXlsxResponse;
}

// PDF format (returns Blob)
export type InventoryItemDetailsPdfQuery = OpQueryParams<Op>;
export type InventoryItemDetailsPdfResponse = Blob;

export async function fetchInventoryItemDetailsPdf(
  fetcher: ApiFetcher,
  query: InventoryItemDetailsPdfQuery
): Promise<InventoryItemDetailsPdfResponse> {
  const get = fetcher.path(INVENTORY_DETAILS_ROUTE).method('get').create();
  const response = await get({ ...query, Accept: 'application/pdf' } as Arg);
  return response.data as unknown as InventoryItemDetailsPdfResponse;
}
