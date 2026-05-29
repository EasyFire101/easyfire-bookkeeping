import React, { createContext, useContext, useMemo } from 'react';
import { FinancialReportPage } from '../FinancialReportPage';
import { useVendorsTransactionsReport } from '@/hooks/query';
import { transformFilterFormToQuery } from '../common';

type UseVendorsTransactionsResult = ReturnType<typeof useVendorsTransactionsReport>;

interface VendorsTransactionsContextValue {
  vendorsTransactions: UseVendorsTransactionsResult['data'];
  isVendorsTransactionsLoading: boolean;
  isVendorsTransactionFetching: boolean;
  refetch: UseVendorsTransactionsResult['refetch'];
  filter: Record<string, unknown>;
  httpQuery: Record<string, unknown>;
}

interface VendorsTransactionsProviderProps {
  filter: Record<string, unknown>;
}

const VendorsTransactionsContext = createContext<VendorsTransactionsContextValue | undefined>(undefined);

/**
 * Vendors transactions provider.
 */
function VendorsTransactionsProvider({ filter, ...props }: VendorsTransactionsProviderProps & { children?: React.ReactNode }) {
  const httpQuery = useMemo(() => transformFilterFormToQuery(filter), [filter]);

  // Fetch vendors transactions based on the given query.
  const {
    data: vendorsTransactions,
    isFetching: isVendorsTransactionFetching,
    isLoading: isVendorsTransactionsLoading,
    refetch,
  } = useVendorsTransactionsReport(httpQuery, {
    placeholderData: (prev) => prev,
  });

  const provider: VendorsTransactionsContextValue = {
    vendorsTransactions,
    isVendorsTransactionsLoading,
    isVendorsTransactionFetching,
    refetch,
    filter,
    httpQuery,
  };

  return (
    <FinancialReportPage name={'vendor-transactions'}>
      <VendorsTransactionsContext.Provider value={provider} {...props} />
    </FinancialReportPage>
  );
}

const useVendorsTransactionsContext = (): VendorsTransactionsContextValue => {
  const ctx = useContext(VendorsTransactionsContext);
  if (!ctx) {
    throw new Error('useVendorsTransactionsContext must be used within a VendorsTransactionsProvider');
  }
  return ctx;
};

export { VendorsTransactionsProvider, useVendorsTransactionsContext };
