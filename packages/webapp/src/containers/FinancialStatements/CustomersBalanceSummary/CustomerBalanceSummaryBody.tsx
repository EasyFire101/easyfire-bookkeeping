import React from 'react';
import { FinancialReportBody } from '../FinancialReportPage';
import { FinancialSheetSkeleton } from '@/components/FinancialSheet';
import { useCustomersBalanceSummaryContext } from './CustomersBalanceSummaryProvider';
import { CustomersBalanceSummaryTable } from './CustomersBalanceSummaryTable';
import { useCurrentOrganizationName } from '@/hooks/query';

function CustomerBalanceSummaryBodyJSX() {
  const organizationName = useCurrentOrganizationName();
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

export const CustomerBalanceSummaryBody = CustomerBalanceSummaryBodyJSX;
