import React, { createContext, useContext, useMemo } from 'react';
import { FinancialReportPage } from '../FinancialReportPage';
import { usePurchasesByItemsTable } from '@/hooks/query';
import { transformFilterFormToQuery } from '../common';

type UsePurchasesByItemsTableResult = ReturnType<typeof usePurchasesByItemsTable>;

type PurchasesByItemsContextValue = {
  purchaseByItems: UsePurchasesByItemsTableResult['data'];
  isFetching: boolean;
  isLoading: boolean;
  refetchSheet: UsePurchasesByItemsTableResult['refetch'];
  httpQuery: Record<string, unknown>;
};

interface PurchasesByItemsProviderProps {
  query: Record<string, unknown>;
  children?: React.ReactNode;
}

const PurchasesByItemsContext = createContext<PurchasesByItemsContextValue | undefined>(undefined);

function PurchasesByItemsProvider({ query, ...props }: PurchasesByItemsProviderProps) {
  // Transforms the report query to http query.
  const httpQuery = useMemo(() => transformFilterFormToQuery(query), [query]);

  // Handle fetching the purchases by items report based on the given query.
  const {
    data: purchaseByItems,
    isFetching,
    isLoading,
    refetch,
  } = usePurchasesByItemsTable(httpQuery, { placeholderData: (prev) => prev });

  const provider: PurchasesByItemsContextValue = {
    purchaseByItems,
    isFetching,
    isLoading,
    refetchSheet: refetch,
    httpQuery,
  };
  return (
    <FinancialReportPage name={'purchase-by-items'}>
      <PurchasesByItemsContext.Provider value={provider} {...props} />
    </FinancialReportPage>
  );
}

const usePurchaseByItemsContext = (): PurchasesByItemsContextValue => {
  const ctx = useContext(PurchasesByItemsContext);
  if (!ctx) throw new Error('PurchasesByItemsContext is not provided');
  return ctx;
};

export { PurchasesByItemsProvider, usePurchaseByItemsContext };
