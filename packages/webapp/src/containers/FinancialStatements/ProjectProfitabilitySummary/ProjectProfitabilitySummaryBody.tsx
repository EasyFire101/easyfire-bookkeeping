import React from 'react';

import { ProjectProfitabilitySummaryTable } from './ProjectProfitabilitySummaryTable';
import { FinancialReportBody } from '../FinancialReportPage';
import { FinancialSheetSkeleton } from '@/components/FinancialSheet';
import { useProjectProfitabilitySummaryContext } from './ProjectProfitabilitySummaryProvider';

import { withCurrentOrganization, WithCurrentOrganizationProps } from '@/containers/Organization/withCurrentOrganization';

import { compose } from '@/utils';

interface ProjectProfitabilitySummaryBodyProps {
  organizationName: WithCurrentOrganizationProps['organization'];
}

/**
 * Project profitability summary body JSX.
 */
function ProjectProfitabilitySummaryBodyJSX({
  // #withCurrentOrganization
  organizationName,
}: ProjectProfitabilitySummaryBodyProps) {
  const { isProjectProfitabilitySummaryLoading } =
    useProjectProfitabilitySummaryContext();

  return (
    <FinancialReportBody>
      {isProjectProfitabilitySummaryLoading ? (
        <FinancialSheetSkeleton />
      ) : (
        <ProjectProfitabilitySummaryTable companyName={organizationName} />
      )}
    </FinancialReportBody>
  );
}

export const ProjectProfitabilitySummaryBody = compose(
  withCurrentOrganization(({ organization }) => ({
    organizationName: organization?.name,
  })),
)(ProjectProfitabilitySummaryBodyJSX);
