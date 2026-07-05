// @ts-nocheck
import { getLemonCheckoutUrl } from '@bigcapital/sdk-ts';
import { useMutation } from '@tanstack/react-query';
import { useApiFetcher } from '../../useRequest';

/**
 * Fetches the checkout url of the Lemon Squeezy.
 */
export const useGetLemonSqueezyCheckout = (props = {}) => {
  const fetcher = useApiFetcher();

  return useMutation({
    ...props,
    mutationFn: (values) => getLemonCheckoutUrl(fetcher, values),
  });
};
