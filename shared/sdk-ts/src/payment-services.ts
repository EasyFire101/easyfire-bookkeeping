import type { ApiFetcher } from './fetch-utils';
import { paths } from './schema';

export const PAYMENT_SERVICES_ROUTES = {
  LIST: '/api/payment-services',
  STATE: '/api/payment-services/state',
  BY_ID: '/api/payment-services/{paymentServiceId}',
  UPDATE_METHOD: '/api/payment-services/{paymentMethodId}',
  DELETE_METHOD: '/api/payment-services/{paymentMethodId}',
} as const satisfies Record<string, keyof paths>;

export interface GetPaymentServicesResponse {
  payment_services?: unknown;
}

export interface GetPaymentServicesStateResponse {
  stripe: {
    is_stripe_account_created: boolean;
    is_stripe_payment_enabled: boolean;
    is_stripe_payout_enabled: boolean;
    is_stripe_enabled: boolean;
    is_stripe_server_configured: boolean;
    stripe_account_id: string | null;
    stripe_payment_method_id: number | null;
    stripe_currencies: string[];
    stripe_publishable_key: string;
    stripe_auth_link: string;
    stripe_redirect_url: string;
  };
}

export interface GetPaymentServiceResponse {
  data?: unknown;
}

export interface EditPaymentMethodOptionsBody {
  bankAccountId?: number;
  clearningAccountId?: number;
  showVisa?: boolean;
  showMasterCard?: boolean;
  showDiscover?: boolean;
  showAmer?: boolean;
  showJcb?: boolean;
  showDiners?: boolean;
}

export interface UpdatePaymentMethodBody {
  name?: string;
  options?: EditPaymentMethodOptionsBody;
}

export interface UpdatePaymentMethodResponse {
  id: number;
  message: string;
}

export interface DeletePaymentMethodResponse {
  id: number;
  message: string;
}

export async function fetchGetPaymentServices(
  fetcher: ApiFetcher,
): Promise<GetPaymentServicesResponse> {
  const get = fetcher
    .path(PAYMENT_SERVICES_ROUTES.LIST)
    .method('get')
    .create();
  const { data } = await get({});
  return data as GetPaymentServicesResponse;
}

export async function fetchGetPaymentServicesState(
  fetcher: ApiFetcher,
): Promise<GetPaymentServicesStateResponse> {
  const get = fetcher
    .path(PAYMENT_SERVICES_ROUTES.STATE)
    .method('get')
    .create();
  const { data } = await get({});
  const wrapped = data as { data?: GetPaymentServicesStateResponse };
  return wrapped?.data ?? (data as GetPaymentServicesStateResponse);
}

export async function fetchGetPaymentService(
  fetcher: ApiFetcher,
  paymentServiceId: number,
): Promise<GetPaymentServiceResponse> {
  const get = fetcher
    .path(PAYMENT_SERVICES_ROUTES.BY_ID)
    .method('get')
    .create();
  const { data } = await get({ paymentServiceId });
  return data as GetPaymentServiceResponse;
}

export async function fetchUpdatePaymentMethod(
  fetcher: ApiFetcher,
  paymentMethodId: number,
  body: UpdatePaymentMethodBody,
): Promise<UpdatePaymentMethodResponse> {
  const post = fetcher
    .path(PAYMENT_SERVICES_ROUTES.UPDATE_METHOD)
    .method('post')
    .create();
  const { data } = await post({ paymentMethodId, ...body } as never);
  return data as UpdatePaymentMethodResponse;
}

export async function fetchDeletePaymentMethod(
  fetcher: ApiFetcher,
  paymentMethodId: number,
): Promise<DeletePaymentMethodResponse> {
  const del = fetcher
    .path(PAYMENT_SERVICES_ROUTES.DELETE_METHOD)
    .method('delete')
    .create();
  const { data } = await del({ paymentMethodId });
  return data as DeletePaymentMethodResponse;
}
