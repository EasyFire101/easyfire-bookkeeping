import {
  useMutation,
  useQuery,
  useQueryClient,
  UseMutationOptions,
  UseQueryOptions,
} from '@tanstack/react-query';
import type {
  CreateManualJournalBody,
  EditManualJournalBody,
  ManualJournal,
  ManualJournalsListQuery,
  ManualJournalsListResponse,
  BulkDeleteManualJournalsBody,
  ValidateBulkDeleteManualJournalsResponse,
} from '@bigcapital/sdk-ts';
import {
  fetchManualJournals,
  fetchManualJournal,
  createManualJournal,
  editManualJournal,
  deleteManualJournal,
  publishManualJournal,
  bulkDeleteManualJournals,
  validateBulkDeleteManualJournals,
} from '@bigcapital/sdk-ts';
import { useApiFetcher } from '../../useRequest';
import { manualJournalsKeys, MANUAL_JOURNAL } from './query-keys';
import { accountsKeys } from '../accounts/query-keys';
import { customersKeys } from '../customers/query-keys';
import { vendorsKeys } from '../vendors/query-keys';
import { cashflowAccountsKeys } from '../cashflow-accounts/query-keys';
import { financialReportsKeys } from '../FinancialReports/query-keys';
import { settingsKeys } from '../settings/query-keys';

const commonInvalidateQueries = (
  queryClient: ReturnType<typeof useQueryClient>,
) => {
  // Invalidate manual journals.
  queryClient.invalidateQueries({ queryKey: manualJournalsKeys.all() });

  // Invalidate customers.
  queryClient.invalidateQueries({ queryKey: customersKeys.all() });

  // Invalidate vendors.
  queryClient.invalidateQueries({ queryKey: vendorsKeys.all() });

  // Invalidate accounts.
  queryClient.invalidateQueries({ queryKey: accountsKeys.all() });

  // Invalidate settings.
  queryClient.invalidateQueries({ queryKey: settingsKeys.manualJournals() });

  // Invalidate financial reports.
  queryClient.invalidateQueries({ queryKey: financialReportsKeys.all() });

  // Invalidate the cashflow transactions.
  queryClient.invalidateQueries({
    queryKey: cashflowAccountsKeys.transactions(),
  });
  queryClient.invalidateQueries({
    queryKey: cashflowAccountsKeys.transactionsInfinity(),
  });
};

/**
 * Creates a new manual journal.
 */
export function useCreateJournal(
  props?: UseMutationOptions<void, Error, CreateManualJournalBody>,
) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();

  return useMutation({
    ...props,
    mutationFn: (values: CreateManualJournalBody) =>
      createManualJournal(fetcher, values),
    onSuccess: () => {
      commonInvalidateQueries(queryClient);
    },
  });
}

export function useEditJournal(
  props?: UseMutationOptions<void, Error, [number, EditManualJournalBody]>,
) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();

  return useMutation({
    ...props,
    mutationFn: ([id, values]: [number, EditManualJournalBody]) =>
      editManualJournal(fetcher, id, values),
    onSuccess: (_res, [id]) => {
      queryClient.invalidateQueries({
        queryKey: manualJournalsKeys.detail(id),
      });
      commonInvalidateQueries(queryClient);
    },
  });
}

export function useDeleteJournal(
  props?: UseMutationOptions<void, Error, number>,
) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();

  return useMutation({
    ...props,
    mutationFn: (id: number) => deleteManualJournal(fetcher, id),
    onSuccess: (_res, id) => {
      queryClient.invalidateQueries({
        queryKey: manualJournalsKeys.detail(id),
      });
      commonInvalidateQueries(queryClient);
    },
  });
}

export function useBulkDeleteManualJournals(
  props?: UseMutationOptions<void, Error, BulkDeleteManualJournalsBody>,
) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();

  return useMutation({
    ...props,
    mutationFn: ({
      ids,
      skipUndeletable = false,
    }: BulkDeleteManualJournalsBody) =>
      bulkDeleteManualJournals(fetcher, { ids, skipUndeletable }),
    onSuccess: () => {
      commonInvalidateQueries(queryClient);
    },
  });
}

export function useValidateBulkDeleteManualJournals(
  props?: UseMutationOptions<
    ValidateBulkDeleteManualJournalsResponse,
    Error,
    number[]
  >,
) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });

  return useMutation({
    ...props,
    mutationFn: (ids: number[]) =>
      validateBulkDeleteManualJournals(fetcher, { ids }),
  });
}

export function usePublishJournal(
  props?: UseMutationOptions<void, Error, number>,
) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();

  return useMutation({
    ...props,
    mutationFn: (id: number) => publishManualJournal(fetcher, id),
    onSuccess: (_res, id) => {
      queryClient.invalidateQueries({
        queryKey: manualJournalsKeys.detail(id),
      });
      commonInvalidateQueries(queryClient);
    },
  });
}

export function useJournals(
  query?: ManualJournalsListQuery | null,
  props?: Omit<
    UseQueryOptions<ManualJournalsListResponse>,
    'queryKey' | 'queryFn'
  >,
) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    ...props,
    queryKey: manualJournalsKeys.list(query ?? undefined),
    queryFn: async () => fetchManualJournals(fetcher, query ?? {}),
  });
}

export function useJournal(
  id: number | null | undefined,
  props?: Omit<UseQueryOptions<ManualJournal>, 'queryKey' | 'queryFn'>,
) {
  const fetcher = useApiFetcher();
  return useQuery({
    ...props,
    queryKey: manualJournalsKeys.detail(id),
    queryFn: () => fetchManualJournal(fetcher, id!),
    enabled: id != null,
  });
}

export function useRefreshJournals() {
  const queryClient = useQueryClient();

  return {
    refresh: () => {
      queryClient.invalidateQueries({ queryKey: manualJournalsKeys.all() });
    },
  };
}
