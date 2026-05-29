import { useMemo, createContext, useContext } from 'react';
import { FinancialReportPage } from '../FinancialReportPage';
import { useARAgingSummaryReport } from '@/hooks/query';
import { transformFilterFormToQuery } from '../common';

type UseARAgingSummaryResult = ReturnType<typeof useARAgingSummaryReport>;

type ARAgingSummaryContextValue = {
  ARAgingSummary: UseARAgingSummaryResult['data'];
  isARAgingLoading: boolean;
  isARAgingFetching: boolean;
  refetch: UseARAgingSummaryResult['refetch'];
  httpQuery: Record<string, unknown>;
};

type ARAgingSummaryProviderProps = {
  filter: Record<string, unknown>;
  children?: React.ReactNode;
};

const ARAgingSummaryContext = createContext<ARAgingSummaryContextValue | undefined>(undefined);

function ARAgingSummaryProvider({ filter, ...props }: ARAgingSummaryProviderProps) {
  const httpQuery = useMemo(() => transformFilterFormToQuery(filter), [filter]);

  const {
    data: ARAgingSummary,
    isLoading: isARAgingLoading,
    isFetching: isARAgingFetching,
    refetch,
  } = useARAgingSummaryReport(httpQuery, { placeholderData: (prev) => prev });

  const provider: ARAgingSummaryContextValue = {
    ARAgingSummary,
    isARAgingLoading,
    isARAgingFetching,
    refetch,
    httpQuery,
  };

  return (
    <FinancialReportPage name={'AR-Aging-Summary'}>
      <ARAgingSummaryContext.Provider value={provider} {...props} />
    </FinancialReportPage>
  );
}

const useARAgingSummaryContext = (): ARAgingSummaryContextValue => {
  const ctx = useContext(ARAgingSummaryContext);
  if (!ctx) throw new Error('useARAgingSummaryContext must be used within ARAgingSummaryProvider');
  return ctx;
};

export { ARAgingSummaryProvider, useARAgingSummaryContext };
