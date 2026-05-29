import React from 'react';
import * as R from 'ramda';
import { FinancialReportBody } from '../FinancialReportPage';
import { FinancialSheetSkeleton } from '@/components/FinancialSheet';
import { useCustomersBalanceSummaryContext } from './CustomersBalanceSummaryProvider';
import { CustomersBalanceSummaryTable } from './CustomersBalanceSummaryTable';
import {
  withCurrentOrganization,
  WithCurrentOrganizationProps,
} from '@/containers/Organization/withCurrentOrganization';

interface CustomerBalanceSummaryBodyProps {
  organizationName: WithCurrentOrganizationProps['organization'];
}

function CustomerBalanceSummaryBodyJSX({
  organizationName,
}: CustomerBalanceSummaryBodyProps) {
  const { isCustomersBalanceLoading } = useCustomersBalanceSummaryContext();

  return (
    <FinancialReportBody>
      {isCustomersBalanceLoading ? (
        <FinancialSheetSkeleton />
      ) : (
        <CustomersBalanceSummaryTable companyName={organizationName} />
      )}
    </FinancialReportBody>
  );
}

export const CustomerBalanceSummaryBody = R.compose(
  withCurrentOrganization(({ organization }) => ({
    organizationName: organization.name,
  })),
)(CustomerBalanceSummaryBodyJSX);
