import { useRequestQuery } from '@/hooks/useQueryRequest';
import { FINANCIAL_REPORT, PROJECT_PROFITABILITY_SUMMARY } from '@/hooks/query/FinancialReports/query-keys';

interface UseProjectProfitabilitySummaryProps {
  select?: (res: any) => any;
  defaultData?: any;
  [key: string]: any;
}

/**
 * Retrieve the profitability summary for the project
 */
export function useProjectProfitabilitySummary(query: Record<string, any>, props?: UseProjectProfitabilitySummaryProps) {
  return useRequestQuery(
    [FINANCIAL_REPORT, PROJECT_PROFITABILITY_SUMMARY, query],
    {
      method: 'get',
      url: '/financial_statements/project-profitability-summary',
      params: query,
      headers: {
        Accept: 'application/json+table',
      },
    },
    {
      select: (res: any) => ({
        columns: res.data.table.columns,
        tableRows: res.data.table.data,
      }),
      defaultData: {
        tableRows: [],
        columns: [],
      },
      ...props,
    },
  );
}
