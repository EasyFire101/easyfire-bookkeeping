import React from 'react';
import moment from 'moment';
import { castArray } from 'lodash';

import { transformToForm } from '@/utils';
import { useAppQueryString } from '@/hooks';

export const getDefaultCashFlowSheetQuery = () => {
  return {
    fromDate: moment().startOf('year').format('YYYY-MM-DD'),
    toDate: moment().format('YYYY-MM-DD'),
    basis: 'cash',
    displayColumnsType: 'total',
    filterByOption: 'with-transactions',
    branchesIds: [],
    numberFormat: {},
  };
};

const parseCashflowQuery = (query: Record<string, unknown>) => {
  const defaultQuery = getDefaultCashFlowSheetQuery();

  const transformed = {
    ...defaultQuery,
    ...transformToForm(query, defaultQuery),
  };
  return {
    ...transformed,

    // Ensures the branches ids is always array.
    branchesIds: castArray(transformed.branchesIds),
  };
};

/**
 * Retrieves the cashflow statement query.
 */
export const useCashflowStatementQuery = () => {
  // Retrieves location query.
  const [locationQuery, setLocationQuery] = useAppQueryString();

  // Merges the default filter query with location URL query.
  const query = React.useMemo(
    () => parseCashflowQuery(locationQuery),
    [locationQuery],
  );

  return {
    query,
    locationQuery,
    setLocationQuery,
  };
};
