import type { ApiFetcher } from './fetch-utils';
import { paths } from './schema';
import { OpForPath, OpQueryParams, OpRequestBody, OpResponseBody } from './utils';

export const BANKING_ACCOUNTS_ROUTES = {
  LIST: '/api/banking/accounts',
  SUMMARY: '/api/banking/accounts/{bankAccountId}/summary',
  TRANSACTIONS: '/api/banking/transactions',
  TRANSACTION_BY_ID: '/api/banking/transactions/{id}',
  UNCATEGORIZED_BY_ACCOUNT: '/api/banking/uncategorized/accounts/{accountId}',
  UNCATEGORIZED_BY_ID: '/api/banking/uncategorized/{uncategorizedTransactionId}',
  CATEGORIZE: '/api/banking/categorize',
  UNCATEGORIZE: '/api/banking/categorize/{id}',
} as const satisfies Record<string, keyof paths>;

export type BankingAccountsListResponse = OpResponseBody<OpForPath<typeof BANKING_ACCOUNTS_ROUTES.LIST, 'get'>>;

/** Bank account summary response (schema does not define response body). */
export interface BankingAccountSummaryResponse {
  name: string;
  totalUncategorizedTransactions: number;
  totalRecognizedTransactions: number;
}

export async function fetchBankingAccounts(fetcher: ApiFetcher): Promise<BankingAccountsListResponse> {
  const get = fetcher.path(BANKING_ACCOUNTS_ROUTES.LIST).method('get').create();
  const { data } = await get({});
  return data;
}

export async function fetchBankingAccountSummary(
  fetcher: ApiFetcher,
  bankAccountId: number
): Promise<BankingAccountSummaryResponse> {
  const get = fetcher.path(BANKING_ACCOUNTS_ROUTES.SUMMARY).method('get').create();
  const { data } = await get({ bankAccountId });
  return data as BankingAccountSummaryResponse;
}

/** Query params for GET /api/banking/transactions. */
export type GetBankingTransactionsQuery = OpQueryParams<
  OpForPath<typeof BANKING_ACCOUNTS_ROUTES.TRANSACTIONS, 'get'>
>;

/** Server returns { transactions, pagination } (OpenAPI schema says data). */
export type BankingTransactionsListResponse = OpResponseBody<
  OpForPath<typeof BANKING_ACCOUNTS_ROUTES.TRANSACTIONS, 'get'>
> & { transactions?: unknown[] };

/** Query params for GET /api/banking/uncategorized/accounts/{accountId}. */
export type GetUncategorizedTransactionsQuery = OpQueryParams<
  OpForPath<typeof BANKING_ACCOUNTS_ROUTES.UNCATEGORIZED_BY_ACCOUNT, 'get'>
>;

/** Body for POST /api/banking/transactions. */
export type CreateBankingTransactionBody = OpRequestBody<
  OpForPath<typeof BANKING_ACCOUNTS_ROUTES.TRANSACTIONS, 'post'>
>;

/** Body for POST /api/banking/categorize. */
export type CategorizeTransactionBody = OpRequestBody<
  OpForPath<typeof BANKING_ACCOUNTS_ROUTES.CATEGORIZE, 'post'>
>;

export async function fetchBankingTransactions(
  fetcher: ApiFetcher,
  query: GetBankingTransactionsQuery
): Promise<BankingTransactionsListResponse> {
  const get = fetcher.path(BANKING_ACCOUNTS_ROUTES.TRANSACTIONS).method('get').create();
  const { data } = await get(query);
  return data as BankingTransactionsListResponse;
}

export async function getBankingTransaction(
  fetcher: ApiFetcher,
  id: string | number
): Promise<unknown> {
  const get = fetcher.path(BANKING_ACCOUNTS_ROUTES.TRANSACTION_BY_ID).method('get').create();
  const { data } = await get({ id: String(id) });
  return data;
}

export async function createBankingTransaction(
  fetcher: ApiFetcher,
  body: CreateBankingTransactionBody
): Promise<void> {
  const post = fetcher.path(BANKING_ACCOUNTS_ROUTES.TRANSACTIONS).method('post').create();
  await post(body);
}

export async function deleteBankingTransaction(
  fetcher: ApiFetcher,
  id: string | number
): Promise<void> {
  const del = fetcher.path(BANKING_ACCOUNTS_ROUTES.TRANSACTION_BY_ID).method('delete').create();
  await del({ id: String(id) });
}

export async function fetchUncategorizedTransactions(
  fetcher: ApiFetcher,
  accountId: number,
  query: GetUncategorizedTransactionsQuery
): Promise<{ data?: unknown[]; pagination: { page: number; pageSize: number; total: number } }> {
  const get = fetcher
    .path(BANKING_ACCOUNTS_ROUTES.UNCATEGORIZED_BY_ACCOUNT)
    .method('get')
    .create();
  const { data } = await get({ accountId, ...query });
  return data as { data?: unknown[]; pagination: { page: number; pageSize: number; total: number } };
}

export async function getUncategorizedTransaction(
  fetcher: ApiFetcher,
  uncategorizedTransactionId: number
): Promise<unknown> {
  const get = fetcher
    .path(BANKING_ACCOUNTS_ROUTES.UNCATEGORIZED_BY_ID)
    .method('get')
    .create();
  const { data } = await get({ uncategorizedTransactionId });
  return data;
}

export async function categorizeTransaction(
  fetcher: ApiFetcher,
  body: CategorizeTransactionBody
): Promise<void> {
  const post = fetcher.path(BANKING_ACCOUNTS_ROUTES.CATEGORIZE).method('post').create();
  await post(body);
}

export async function uncategorizeTransaction(
  fetcher: ApiFetcher,
  id: number
): Promise<void> {
  const del = fetcher.path(BANKING_ACCOUNTS_ROUTES.UNCATEGORIZE).method('delete').create();
  await del({ id });
}
