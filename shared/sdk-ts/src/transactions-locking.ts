import type { ApiFetcher } from './fetch-utils';
import { paths } from './schema';
import { OpForPath, OpResponseBody } from './utils';

export const TRANSACTIONS_LOCKING_ROUTES = {
  LOCK: '/api/transactions-locking/lock',
  CANCEL_LOCK: '/api/transactions-locking/cancel-lock',
  UNLOCK_PARTIAL: '/api/transactions-locking/unlock-partial',
  CANCEL_UNLOCK_PARTIAL: '/api/transactions-locking/cancel-unlock-partial',
  LIST: '/api/transactions-locking',
  BY_MODULE: '/api/transactions-locking/{module}',
} as const satisfies Record<string, keyof paths>;

export type TransactionsLockingListResponse = OpResponseBody<OpForPath<typeof TRANSACTIONS_LOCKING_ROUTES.LIST, 'get'>>;

export async function fetchTransactionsLocking(fetcher: ApiFetcher): Promise<TransactionsLockingListResponse> {
  const get = fetcher.path(TRANSACTIONS_LOCKING_ROUTES.LIST).method('get').create();
  const { data } = await get({});
  return data;
}

export async function fetchTransactionsLockingByModule(
  fetcher: ApiFetcher,
  module: string
): Promise<unknown> {
  const get = fetcher.path(TRANSACTIONS_LOCKING_ROUTES.BY_MODULE).method('get').create();
  const { data } = await get({ module });
  return data;
}

export async function lockTransactions(
  fetcher: ApiFetcher,
  values: Record<string, unknown>
): Promise<void> {
  const put = fetcher.path(TRANSACTIONS_LOCKING_ROUTES.LOCK).method('put').create();
  await put(values as never);
}

export async function cancelLockTransactions(
  fetcher: ApiFetcher,
  values: Record<string, unknown>
): Promise<void> {
  const put = fetcher.path(TRANSACTIONS_LOCKING_ROUTES.CANCEL_LOCK).method('put').create();
  await put(values as never);
}

export async function unlockPartialTransactions(
  fetcher: ApiFetcher,
  values: Record<string, unknown>
): Promise<void> {
  const put = fetcher.path(TRANSACTIONS_LOCKING_ROUTES.UNLOCK_PARTIAL).method('put').create();
  await put(values as never);
}

export async function cancelUnlockPartialTransactions(
  fetcher: ApiFetcher,
  values: Record<string, unknown>
): Promise<void> {
  const put = fetcher.path(TRANSACTIONS_LOCKING_ROUTES.CANCEL_UNLOCK_PARTIAL).method('put').create();
  await put(values as never);
}
