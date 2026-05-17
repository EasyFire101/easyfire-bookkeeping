import type { ApiFetcher } from './fetch-utils';
import { rawRequest } from './fetch-utils';
import { paths } from './schema';
import { OpForPath, OpQueryParams, OpRequestBody, OpResponseBody } from './utils';

export const SETTINGS_ROUTES = {
  GET_SAVE: '/api/settings',
} as const satisfies Record<string, keyof paths>;

export type SettingsResponse = OpResponseBody<OpForPath<typeof SETTINGS_ROUTES.GET_SAVE, 'get'>>;
export type SaveSettingsBody = OpRequestBody<OpForPath<typeof SETTINGS_ROUTES.GET_SAVE, 'put'>>;
export type GetSettingsQuery = OpQueryParams<OpForPath<typeof SETTINGS_ROUTES.GET_SAVE, 'get'>>;

export async function fetchSettings(
  fetcher: ApiFetcher,
  query?: GetSettingsQuery
): Promise<SettingsResponse> {
  const get = fetcher.path(SETTINGS_ROUTES.GET_SAVE).method('get').create();
  const { data } = await (get as (params?: GetSettingsQuery) => Promise<{ data: SettingsResponse }>)(
    query ?? {}
  );
  return data;
}

export async function saveSettings(
  fetcher: ApiFetcher,
  values: SaveSettingsBody
): Promise<void> {
  const put = fetcher.path(SETTINGS_ROUTES.GET_SAVE).method('put').create();
  await put(values);
}

export const editSettings = saveSettings;

// Settings group fetchers

export async function fetchSettingsInvoices(
  fetcher: ApiFetcher
): Promise<SettingsResponse> {
  return fetchSettings(fetcher, { group: 'sale_invoices' } as GetSettingsQuery);
}

export async function fetchSettingsEstimates(
  fetcher: ApiFetcher
): Promise<SettingsResponse> {
  return fetchSettings(fetcher, { group: 'sale_estimates' } as GetSettingsQuery);
}

export async function fetchSettingsPaymentReceives(
  fetcher: ApiFetcher
): Promise<SettingsResponse> {
  return fetchSettings(fetcher, { group: 'payment_receives' } as GetSettingsQuery);
}

export async function fetchSettingsReceipts(
  fetcher: ApiFetcher
): Promise<SettingsResponse> {
  return fetchSettings(fetcher, { group: 'sale_receipts' } as GetSettingsQuery);
}

export async function fetchSettingsManualJournals(
  fetcher: ApiFetcher
): Promise<SettingsResponse> {
  return fetchSettings(fetcher, { group: 'manual_journals' } as GetSettingsQuery);
}

export async function fetchSettingsItems(
  fetcher: ApiFetcher
): Promise<SettingsResponse> {
  return fetchSettings(fetcher, { group: 'items' } as GetSettingsQuery);
}

export async function fetchSettingCashFlow(
  fetcher: ApiFetcher
): Promise<SettingsResponse> {
  return fetchSettings(fetcher, { group: 'cashflow' } as GetSettingsQuery);
}

export async function fetchSettingsCreditNotes(
  fetcher: ApiFetcher
): Promise<SettingsResponse> {
  return fetchSettings(fetcher, { group: 'credit_note' } as GetSettingsQuery);
}

export async function fetchSettingsVendorCredits(
  fetcher: ApiFetcher
): Promise<SettingsResponse> {
  return fetchSettings(fetcher, { group: 'vendor_credit' } as GetSettingsQuery);
}

export async function fetchSettingsWarehouseTransfers(
  fetcher: ApiFetcher
): Promise<SettingsResponse> {
  return fetchSettings(fetcher, { group: 'warehouse_transfers' } as GetSettingsQuery);
}

// SMS Notification settings (using raw fetch since endpoints are not in OpenAPI schema)

export async function fetchSettingSMSNotifications(fetcher: ApiFetcher): Promise<unknown> {
  return rawRequest(fetcher, 'GET', '/api/settings/sms-notifications');
}

export async function fetchSettingSMSNotification(
  fetcher: ApiFetcher,
  key: string
): Promise<unknown> {
  return rawRequest(fetcher, 'GET', `/api/settings/sms-notification/${encodeURIComponent(key)}`);
}

export async function editSettingSMSNotification(
  fetcher: ApiFetcher,
  key: string,
  values: Record<string, unknown>
): Promise<unknown> {
  return rawRequest(fetcher, 'POST', '/api/settings/sms-notification', { key, ...values });
}
