import type { ApiFetcher } from './fetch-utils';
import { paths } from './schema';
import { OpForPath, OpQueryParams, OpRequestBody, OpResponseBody } from './utils';

export const SALE_ESTIMATES_ROUTES = {
  LIST: '/api/sale-estimates',
  BY_ID: '/api/sale-estimates/{id}',
  STATE: '/api/sale-estimates/state',
  VALIDATE_BULK_DELETE: '/api/sale-estimates/validate-bulk-delete',
  BULK_DELETE: '/api/sale-estimates/bulk-delete',
  DELIVER: '/api/sale-estimates/{id}/deliver',
  APPROVE: '/api/sale-estimates/{id}/approve',
  REJECT: '/api/sale-estimates/{id}/reject',
  NOTIFY_SMS: '/api/sale-estimates/{id}/notify-sms',
  SMS_DETAILS: '/api/sale-estimates/{id}/sms-details',
  MAIL: '/api/sale-estimates/{id}/mail',
} as const satisfies Record<string, keyof paths>;

export type SaleEstimatesListResponse = OpResponseBody<OpForPath<typeof SALE_ESTIMATES_ROUTES.LIST, 'get'>>;
export type SaleEstimate = OpResponseBody<OpForPath<typeof SALE_ESTIMATES_ROUTES.BY_ID, 'get'>>;
export type CreateSaleEstimateBody = OpRequestBody<OpForPath<typeof SALE_ESTIMATES_ROUTES.LIST, 'post'>>;
export type EditSaleEstimateBody = OpRequestBody<OpForPath<typeof SALE_ESTIMATES_ROUTES.BY_ID, 'put'>>;
export type GetSaleEstimatesQuery = OpQueryParams<OpForPath<typeof SALE_ESTIMATES_ROUTES.LIST, 'get'>>;

export async function fetchSaleEstimates(
  fetcher: ApiFetcher,
  query?: GetSaleEstimatesQuery
): Promise<SaleEstimatesListResponse> {
  const get = fetcher.path(SALE_ESTIMATES_ROUTES.LIST).method('get').create();
  const { data } = await get(query || {});
  return data;
}

export async function fetchSaleEstimate(fetcher: ApiFetcher, id: number): Promise<SaleEstimate> {
  const get = fetcher.path(SALE_ESTIMATES_ROUTES.BY_ID).method('get').create();
  const { data } = await get({ id });
  return data;
}

export async function createSaleEstimate(
  fetcher: ApiFetcher,
  values: CreateSaleEstimateBody
): Promise<void> {
  const post = fetcher.path(SALE_ESTIMATES_ROUTES.LIST).method('post').create();
  await post(values);
}

export async function editSaleEstimate(
  fetcher: ApiFetcher,
  id: number,
  values: EditSaleEstimateBody
): Promise<void> {
  const put = fetcher.path(SALE_ESTIMATES_ROUTES.BY_ID).method('put').create();
  await put({ id, ...values });
}

export async function deleteSaleEstimate(fetcher: ApiFetcher, id: number): Promise<void> {
  const del = fetcher.path(SALE_ESTIMATES_ROUTES.BY_ID).method('delete').create();
  await del({ id });
}

export type BulkDeleteEstimatesBody = { ids: number[]; skipUndeletable?: boolean };
export type ValidateBulkDeleteEstimatesResponse = {
  deletableCount: number;
  nonDeletableCount: number;
  deletableIds: number[];
  nonDeletableIds: number[];
};

export async function bulkDeleteSaleEstimates(
  fetcher: ApiFetcher,
  body: BulkDeleteEstimatesBody
): Promise<void> {
  const post = fetcher.path(SALE_ESTIMATES_ROUTES.BULK_DELETE).method('post').create();
  await post({ ids: body.ids, skipUndeletable: body.skipUndeletable ?? false } as never);
}

export async function validateBulkDeleteSaleEstimates(
  fetcher: ApiFetcher,
  ids: number[]
): Promise<ValidateBulkDeleteEstimatesResponse> {
  const post = fetcher.path(SALE_ESTIMATES_ROUTES.VALIDATE_BULK_DELETE).method('post').create();
  const { data } = await post({ ids, skipUndeletable: false } as never);
  return data as ValidateBulkDeleteEstimatesResponse;
}

export async function deliverSaleEstimate(fetcher: ApiFetcher, id: number): Promise<void> {
  const post = fetcher.path(SALE_ESTIMATES_ROUTES.DELIVER).method('post').create();
  await post({ id });
}

export async function approveSaleEstimate(fetcher: ApiFetcher, id: number): Promise<void> {
  const put = fetcher.path(SALE_ESTIMATES_ROUTES.APPROVE).method('put').create();
  await put({ id });
}

export async function rejectSaleEstimate(fetcher: ApiFetcher, id: number): Promise<void> {
  const put = fetcher.path(SALE_ESTIMATES_ROUTES.REJECT).method('put').create();
  await put({ id });
}

export async function notifySaleEstimateBySms(
  fetcher: ApiFetcher,
  id: number,
  body?: Record<string, unknown>
): Promise<void> {
  const post = fetcher.path(SALE_ESTIMATES_ROUTES.NOTIFY_SMS).method('post').create();
  await post({ id, ...(body ?? {}) } as never);
}

export async function fetchSaleEstimateSmsDetails(
  fetcher: ApiFetcher,
  id: number
): Promise<unknown> {
  const get = fetcher.path(SALE_ESTIMATES_ROUTES.SMS_DETAILS).method('get').create();
  const { data } = await get({ id });
  return data;
}

export async function fetchSaleEstimateMail(fetcher: ApiFetcher, id: number): Promise<unknown> {
  const get = fetcher.path(SALE_ESTIMATES_ROUTES.MAIL).method('get').create();
  const { data } = await get({ id });
  return data;
}

export async function sendSaleEstimateMail(
  fetcher: ApiFetcher,
  id: number,
  body?: Record<string, unknown>
): Promise<void> {
  const post = fetcher.path(SALE_ESTIMATES_ROUTES.MAIL).method('post').create();
  await post({ id, ...(body ?? {}) } as never);
}

export async function fetchSaleEstimatesState(fetcher: ApiFetcher): Promise<unknown> {
  const get = fetcher.path(SALE_ESTIMATES_ROUTES.STATE).method('get').create();
  const { data } = await get({});
  return data;
}
