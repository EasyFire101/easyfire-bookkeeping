import { fetchOrganizationBuildJob } from '@bigcapital/sdk-ts';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { useApiFetcher } from '../../useRequest';
import { jobsKeys } from './query-keys';

/**
 * Retrieve the job metadata.
 */
export function useJob(
  jobId: string | number | null | undefined,
  props: Omit<UseQueryOptions, 'queryKey' | 'queryFn'> = {},
) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    ...props,
    queryKey: jobsKeys.detail(jobId),
    // @ts-expect-error - jobId is checked by enabled option
    queryFn: () => fetchOrganizationBuildJob(fetcher, jobId),
    enabled: jobId != null,
  });
}
