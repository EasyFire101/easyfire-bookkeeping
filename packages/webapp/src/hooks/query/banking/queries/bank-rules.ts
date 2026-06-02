import type { QueryClient } from '@tanstack/react-query';
import {
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { CreateBankRuleBody, EditBankRuleBody } from '@bigcapital/sdk-ts';
import {
  createBankRule,
  deleteBankRule,
  editBankRule,
  fetchBankRule,
  fetchBankRules,
} from '@bigcapital/sdk-ts';
import { useApiFetcher } from '../../../useRequest';
import { bankingKeys } from '../query-keys';

const commonInvalidateQueries = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: bankingKeys.rules() });
  queryClient.invalidateQueries({
    queryKey: bankingKeys.recognizedTransactionsInfinity(),
  });
};

export function useCreateBankRule(
  options?: UseMutationOptions<unknown, Error, CreateBankRuleBody>,
): UseMutationResult<unknown, Error, CreateBankRuleBody> {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();

  return useMutation({
    ...options,
    mutationFn: (values: CreateBankRuleBody) => createBankRule(fetcher, values),
    onSuccess: () => commonInvalidateQueries(queryClient),
  });
}

export function useEditBankRule(
  options?: UseMutationOptions<
    unknown,
    Error,
    { id: number; value: EditBankRuleBody }
  >,
): UseMutationResult<unknown, Error, { id: number; value: EditBankRuleBody }> {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();

  return useMutation({
    ...options,
    mutationFn: ({ id, value }: { id: number; value: EditBankRuleBody }) =>
      editBankRule(fetcher, id, value),
    onSuccess: () => commonInvalidateQueries(queryClient),
  });
}

export function useDeleteBankRule(
  options?: UseMutationOptions<unknown, Error, number>,
): UseMutationResult<unknown, Error, number> {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();

  return useMutation({
    ...options,
    mutationFn: (id: number) => deleteBankRule(fetcher, id),
    onSuccess: () => {
      commonInvalidateQueries(queryClient);
      queryClient.invalidateQueries({
        queryKey: bankingKeys.recognizedTransactionsInfinity(),
      });
    },
  });
}

export function useBankRules(
  options?: UseQueryOptions<unknown, Error>,
): UseQueryResult<unknown, Error> {
  const fetcher = useApiFetcher();

  return useQuery({
    ...options,
    queryKey: bankingKeys.rules(),
    queryFn: () => fetchBankRules(fetcher),
  });
}

export function useBankRule(
  bankRuleId: number,
  options?: Omit<UseQueryOptions<unknown, Error>, 'queryKey'>,
): UseQueryResult<unknown, Error> {
  const fetcher = useApiFetcher();

  return useQuery({
    ...options,
    queryKey: bankingKeys.rule(bankRuleId),
    queryFn: () => fetchBankRule(fetcher, bankRuleId),
  });
}
