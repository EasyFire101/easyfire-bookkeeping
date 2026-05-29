import { createContext, useContext, useMemo } from 'react';
import { FinancialReportPage } from '../FinancialReportPage';
import { useSalesByItemsTable } from '@/hooks/query';
import { transformFilterFormToQuery } from '../common';

type UseSalesByItemsTableResult = ReturnType<typeof useSalesByItemsTable>;

type SalesByItemsContextValue = {
  salesByItems: UseSalesByItemsTableResult['data'];
  isFetching: boolean;
  isLoading: boolean;
  refetchSheet: UseSalesByItemsTableResult['refetch'];
  httpQuery: Record<string, unknown>;
};

interface SalesByItemProviderProps {
  query: Record<string, unknown>;
  children?: React.ReactNode;
}

const SalesByItemsContext = createContext<SalesByItemsContextValue | undefined>(undefined);

function SalesByItemProvider({ query, ...props }: SalesByItemProviderProps) {
  // Transforms the sheet query to http query.
  const httpQuery = useMemo(() => transformFilterFormToQuery(query), [query]);

  const {
    data: salesByItems,
    isFetching,
    isLoading,
    refetch,
  } = useSalesByItemsTable({ ...httpQuery }, { placeholderData: (prev) => prev });

  const provider: SalesByItemsContextValue = {
    salesByItems,
    isFetching,
    isLoading,
    refetchSheet: refetch,
    httpQuery,
  };
  return (
    <FinancialReportPage name={'sales-by-items'}>
      <SalesByItemsContext.Provider value={provider} {...props} />
    </FinancialReportPage>
  );
}

const useSalesByItemsContext = (): SalesByItemsContextValue => {
  const ctx = useContext(SalesByItemsContext);
  if (!ctx) throw new Error('SalesByItemsContext is not provided');
  return ctx;
};

export { SalesByItemProvider, useSalesByItemsContext };
