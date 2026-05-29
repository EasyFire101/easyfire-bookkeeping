import React from 'react';
import * as R from 'ramda';

import { FinancialSheetSkeleton } from '@/components';
import { FinancialReportBody } from '../FinancialReportPage';
import { useTrialBalanceSheetContext } from './TrialBalanceProvider';
import { TrialBalanceSheetTable } from './TrialBalanceSheetTable';

import { withCurrentOrganization, WithCurrentOrganizationProps } from '@/containers/Organization/withCurrentOrganization';

interface TrialBalanceSheetBodyProps {
  organizationName: WithCurrentOrganizationProps['organization'];
}

/**
 * Trial balance sheet body.
 * @returns {React.JSX}
 */
function TrialBalanceSheetBodyJSX({
  // #withCurrentOrganization
  organizationName,
}: TrialBalanceSheetBodyProps) {
  const { isLoading } = useTrialBalanceSheetContext();

  return (
    <FinancialReportBody>
      {isLoading ? (
        <FinancialSheetSkeleton />
      ) : (
        <TrialBalanceSheetTable companyName={organizationName} />
      )}
    </FinancialReportBody>
  );
}

export const TrialBalanceSheetBody = R.compose(
  withCurrentOrganization(({ organization }: WithCurrentOrganizationProps) => ({
    organizationName: organization.name,
  })),
)(TrialBalanceSheetBodyJSX);
