import { UseMutationOptions, useMutation } from '@tanstack/react-query';
import type {
  PlaidExchangeTokenBody,
  PlaidLinkTokenResponse,
} from '@bigcapital/sdk-ts';
import {
  fetchPlaidExchangeToken,
  fetchPlaidLinkToken,
} from '@bigcapital/sdk-ts';
import { useApiFetcher } from '../../../useRequest';

/**
 * Retrieves the Plaid link token.
 */
export function useGetPlaidLinkToken(
  props?: UseMutationOptions<PlaidLinkTokenResponse, Error, void>,
) {
  const fetcher = useApiFetcher();
  return useMutation({
    ...props,
    mutationFn: () => fetchPlaidLinkToken(fetcher),
  });
}

/**
 * Exchanges the Plaid public token for an access token.
 */
export function usePlaidExchangeToken(
  props?: UseMutationOptions<void, Error, PlaidExchangeTokenBody>,
) {
  const fetcher = useApiFetcher();

  return useMutation({
    ...props,
    mutationFn: (data: PlaidExchangeTokenBody) =>
      fetchPlaidExchangeToken(fetcher, data),
  });
}
