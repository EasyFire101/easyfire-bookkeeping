import React, { useEffect } from 'react';
import moment from 'moment';

import {
  ProjectProfitabilitySummaryAlerts,
  ProjectProfitabilitySummaryLoadingBar,
} from './components';
import { FinancialStatement, DashboardPageContent } from '@/components';

import { ProjectProfitabilitySummaryHeader } from './ProjectProfitabilitySummaryHeader';
import { ProjectProfitabilitySummaryActionsBar } from './ProjectProfitabilitySummaryActionsBar';
import { ProjectProfitabilitySummaryBody } from './ProjectProfitabilitySummaryBody';
import { ProjectProfitabilitySummaryProvider } from './ProjectProfitabilitySummaryProvider';
import { useProjectProfitabilitySummaryQuery } from './utils';
import { withProjectProfitabilitySummaryActions, WithProjectProfitabilitySummaryActionsProps } from './withProjectProfitabilitySummaryActions';
import { compose } from '@/utils';

interface ProjectProfitabilitySummaryProps extends WithProjectProfitabilitySummaryActionsProps {}

/**
 * Project profitability summary.
 */
function ProjectProfitabilitySummaryInner({
  // #withProjectProfitabilitySummaryActions
  toggleProjectProfitabilitySummaryFilterDrawer,
}: ProjectProfitabilitySummaryProps) {
  // Project profitability summary query.
  const { query, setLocationQuery } = useProjectProfitabilitySummaryQuery();

  // Handle refetch project profitability summary filter changer.
  const handleFilterSubmit = (filter: Record<string, any>) => {
    const newFilter = {
      ...filter,
      fromDate: moment(filter.fromDate).format('YYYY-MM-DD'),
      toDate: moment(filter.toDate).format('YYYY-MM-DD'),
    };
    setLocationQuery({ ...newFilter });
  };
  // Handle number format submit.
  const handleNumberFormatSubmit = (values: Record<string, unknown>) => {
    setLocationQuery({
      ...query,
      numberFormat: values,
    });
  };

  useEffect(
    () => () => {
      toggleProjectProfitabilitySummaryFilterDrawer(false);
    },
    [toggleProjectProfitabilitySummaryFilterDrawer],
  );

  return (
    <ProjectProfitabilitySummaryProvider filter={query}>
      <ProjectProfitabilitySummaryActionsBar
        numberFormat={query.numberFormat}
        onNumberFormatSubmit={handleNumberFormatSubmit}
      />
      <ProjectProfitabilitySummaryLoadingBar />
      <ProjectProfitabilitySummaryAlerts />

      <DashboardPageContent>
        <FinancialStatement>
          <ProjectProfitabilitySummaryHeader
            pageFilter={query}
            onFilterSubmit={handleFilterSubmit}
          />
          <ProjectProfitabilitySummaryBody />
        </FinancialStatement>
      </DashboardPageContent>
    </ProjectProfitabilitySummaryProvider>
  );
}

export const ProjectProfitabilitySummary = compose(withProjectProfitabilitySummaryActions)(
  ProjectProfitabilitySummaryInner,
);
