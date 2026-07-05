// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { castArray, defaultTo } from 'lodash';
import { useRef } from 'react';
import { normalizeApiPath } from '../utils';
import { useAuthOrganizationId } from './state';
import useApiRequest from './useRequest';

/**
 * Query for tenant requests.
 */
export function useQueryTenant(query, callback, props) {
  const organizationId = useAuthOrganizationId();

  return useQuery({
    queryKey: [...castArray(query), organizationId],
    queryFn: callback,
    ...props,
  });
}

export function useRequestQuery(query, axios, props) {
  const apiRequest = useApiRequest();
  const { defaultData: defaultDataProp, ...restProps } = props || {};

  const states = useQuery({
    queryKey: query,
    queryFn: () =>
      apiRequest.http({
        ...axios,
        url: `/api/${normalizeApiPath(axios.url)}`,
      }),
    placeholderData: defaultDataProp,
    ...restProps,
  });
  const defaultData = useRef(defaultDataProp ?? undefined);

  return {
    ...states,
    data: defaultTo(states.data, defaultData.current),
  };
}
