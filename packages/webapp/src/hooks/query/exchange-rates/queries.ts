import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import {
  fetchLatestExchangeRate,
  ExchangeRateLatestResponse,
} from '@bigcapital/sdk-ts';
import { exchangeRateKeys } from './query-keys';
import { useApiFetcher } from '../../useRequest';

interface LatestExchangeRateQuery {
  fromCurrency?: string;
  toCurrency?: string;
}

/**
 * Retrieves latest exchange rate.
 */
export function useLatestExchangeRate(
  { toCurrency, fromCurrency }: LatestExchangeRateQuery,
  props?: Omit<UseQueryOptions<ExchangeRateLatestResponse>, 'queryKey' | 'queryFn'>,
) {
  const fetcher = useApiFetcher();

  return useQuery<ExchangeRateLatestResponse>({
    ...props,
    queryKey: exchangeRateKeys.rate(fromCurrency, toCurrency),
    queryFn: () =>
      fetchLatestExchangeRate(fetcher, {
        from_currency: fromCurrency,
        to_currency: toCurrency,
      }),
  });
}
