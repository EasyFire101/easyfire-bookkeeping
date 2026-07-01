import React, { createContext } from 'react';
import { isEmpty } from 'lodash';

import { DashboardInsider } from '@/components/Dashboard';

import { useResourceViews, useResourceMeta, useEstimates } from '@/hooks/query';
import { getFieldsFromResourceMeta } from '@/utils';
import type { EstimateTableRow } from './components';

interface EstimatesListProviderProps {
  query?: any;
  tableStateChanged?: boolean;
  children?: React.ReactNode;
}

export interface EstimatesListContextValue {
  estimates: EstimateTableRow[] | undefined;
  pagination: { total?: number; [key: string]: any } | undefined;
  fields: Record<string, any>[];
  estimatesViews: any;
  isResourceLoading: boolean;
  isResourceFetching: boolean;
  isEstimatesLoading: boolean;
  isEstimatesFetching: boolean;
  isViewsLoading: boolean;
  isEmptyStatus: boolean;
}

const EstimatesListContext = createContext<EstimatesListContextValue>(
  {} as EstimatesListContextValue,
);

function EstimatesListProvider({
  query,
  tableStateChanged,
  ...props
}: EstimatesListProviderProps) {
  const { data: estimatesViews, isLoading: isViewsLoading } =
    useResourceViews('sale_estimates');

  const {
    data: resourceMeta,
    isLoading: isResourceLoading,
    isFetching: isResourceFetching,
  } = useResourceMeta('sale_estimates');

  const {
    data: estimatesData,
    isLoading: isEstimatesLoading,
    isFetching: isEstimatesFetching,
  } = useEstimates(query);

  const isEmptyStatus =
    !isEstimatesLoading && !tableStateChanged && isEmpty(estimatesData?.data);

  const provider: EstimatesListContextValue = {
    estimates: estimatesData?.data as EstimateTableRow[] | undefined,
    pagination: estimatesData?.pagination,

    fields: resourceMeta?.fields
      ? getFieldsFromResourceMeta(resourceMeta.fields)
      : [],
    estimatesViews,

    isResourceLoading,
    isResourceFetching,

    isEstimatesLoading,
    isEstimatesFetching,
    isViewsLoading,

    isEmptyStatus,
  };

  return (
    <DashboardInsider
      loading={isViewsLoading || isResourceLoading}
      name={'sale_estimate'}
    >
      <EstimatesListContext.Provider value={provider} {...props} />
    </DashboardInsider>
  );
}

const useEstimatesListContext = () => React.useContext(EstimatesListContext);

export { EstimatesListProvider, useEstimatesListContext };
