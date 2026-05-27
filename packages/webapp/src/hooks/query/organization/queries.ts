import { useEffect } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  UseMutationOptions,
  UseQueryOptions,
} from '@tanstack/react-query';
import { batch } from 'react-redux';
import { omit } from 'lodash';
import type {
  OrganizationCurrent,
  UpdateOrganizationBody,
  BuildOrganizationBody,
  OrgBaseCurrencyMutateAbilitiesResponse,
} from '@bigcapital/sdk-ts';
import {
  fetchOrganizationCurrent,
  buildOrganization,
  updateOrganization,
  fetchOrgBaseCurrencyMutateAbilities,
} from '@bigcapital/sdk-ts';
import { organizationKeys } from './query-keys';
import { useApiFetcher } from '../../useRequest';
import { useRequestQuery } from '../../useQueryRequest';
import { useSetOrganizations, useSetSubscriptions } from '../../state';

/**
 * Retrieve organizations of the authenticated user.
 * Uses useRequestQuery because organization/all is not in OpenAPI schema.
 */
export function useOrganizations(props?: Record<string, unknown>) {
  return useRequestQuery(
    organizationKeys.all(),
    { method: 'get', url: `organization/all` },
    {
      select: (res: { data: { organizations: unknown[] } }) => res.data.organizations,
      initialDataUpdatedAt: 0,
      initialData: {
        data: {
          organizations: [],
        },
      },
      ...props,
    },
  );
}

/**
 * Retrieve the current organization metadata.
 */
export function useCurrentOrganization(
  props?: Omit<UseQueryOptions<OrganizationCurrent>, 'queryKey' | 'queryFn'>
) {
  const setOrganizations = useSetOrganizations();
  const setSubscriptions = useSetSubscriptions();
  const fetcher = useApiFetcher();

  const result = useQuery({
    ...props,
    queryKey: organizationKeys.current(),
    queryFn: () => fetchOrganizationCurrent(fetcher),
  });

  useEffect(() => {
    if (result.isSuccess && result.data) {
      const data = result.data as OrganizationCurrent & { subscriptions?: unknown };
      const organization = omit(data, ['subscriptions']);
      batch(() => {
        setSubscriptions(data.subscriptions);
        setOrganizations([organization]);
      });
    }
  }, [result.isSuccess, result.data, setSubscriptions, setOrganizations]);

  return result;
}

/**
 * Organization setup.
 */
export function useOrganizationSetup(
  props?: UseMutationOptions<void, Error, BuildOrganizationBody>
) {
  const fetcher = useApiFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    ...props,
    mutationFn: (values: BuildOrganizationBody) => buildOrganization(fetcher, values) as Promise<void>,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.current() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.all() });
      props?.onSuccess?.(...args);
    },
  });
}

/**
 * Saves the organization.
 */
export function useUpdateOrganization(
  props?: UseMutationOptions<void, Error, UpdateOrganizationBody>
) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();

  return useMutation({
    ...props,
    mutationFn: (information: UpdateOrganizationBody) => updateOrganization(fetcher, information),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.current() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.all() });
      props?.onSuccess?.(...args);
    },
  });
}

export function useOrgBaseCurrencyMutateAbilities(
  props?: Omit<UseQueryOptions<OrgBaseCurrencyMutateAbilitiesResponse>, 'queryKey' | 'queryFn'>
) {
  const fetcher = useApiFetcher();

  return useQuery({
    ...props,
    queryKey: organizationKeys.mutateAbilities(),
    queryFn: () => fetchOrgBaseCurrencyMutateAbilities(fetcher),
    select: (data: OrgBaseCurrencyMutateAbilitiesResponse) => data?.abilities ?? [],
  });
}
