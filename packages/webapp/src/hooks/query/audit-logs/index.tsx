import * as qs from 'qs';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import useApiRequest from '../../useRequest';
import { normalizeApiPath } from '@/utils';
import { AUDIT_LOGS, AUDIT_LOG_FILTER_OPTIONS } from './query-keys';

export { AuditLogsQueryKeys } from './query-keys';

const qsArrayOptions = { skipNulls: true, arrayFormat: 'repeat' as const };

function auditLogStringListParam(value: string | string[] | null | undefined) {
  if (value == null || value === '') return undefined;
  if (Array.isArray(value)) return value.length ? value : undefined;
  return [value];
}

export function useAuditLogsQuery(filters: Record<string, any>, props?: Record<string, any>) {
  const apiRequest = useApiRequest();

  const query = qs.stringify(
    {
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 20,
      subject: auditLogStringListParam(filters.subject),
      action: auditLogStringListParam(filters.action),
      userId: filters.userId || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    },
    qsArrayOptions,
  );

  return useQuery({
    queryKey: [AUDIT_LOGS, filters],
    queryFn: () =>
      apiRequest
        .http({ method: 'get', url: `/api/${normalizeApiPath(`audit-logs?${query}`)}` })
        .then((res) => res.data),
    keepPreviousData: true,
    ...props,
  });
}

export function useAuditLogFilterOptionsQuery(props?: Record<string, any>) {
  const apiRequest = useApiRequest();

  return useQuery({
    queryKey: [AUDIT_LOG_FILTER_OPTIONS],
    queryFn: () =>
      apiRequest
        .http({ method: 'get', url: `/api/${normalizeApiPath('audit-logs/filter-options')}` })
        .then((res) => ({
          subjects: res.data?.subjects ?? [],
          actions: res.data?.actions ?? [],
        })),
    placeholderData: { subjects: [], actions: [] },
    staleTime: 5 * 60 * 1000,
    ...props,
  });
}

export function useAuditLogsInfinityQuery(
  filters: Record<string, any>,
  infinityProps?: Record<string, any>,
) {
  const apiRequest = useApiRequest();

  return useInfiniteQuery(
    [AUDIT_LOGS, filters],
    async ({ pageParam = 1 }) => {
      const query = qs.stringify(
        {
          page: pageParam,
          pageSize: filters.pageSize ?? 20,
          subject: auditLogStringListParam(filters.subject),
          action: auditLogStringListParam(filters.action),
          userId: filters.userId || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
        },
        qsArrayOptions,
      );

      const response = await apiRequest.http({
        method: 'get',
        url: `/api/${normalizeApiPath(`audit-logs?${query}`)}`,
      });
      return response.data;
    },
    {
      getNextPageParam: (lastPage: any) => {
        const { pagination } = lastPage;
        return pagination.total > pagination.page_size * pagination.page
          ? pagination.page + 1
          : undefined;
      },
      ...infinityProps,
    },
  );
}
