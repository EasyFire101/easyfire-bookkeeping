import React from 'react';
import * as R from 'ramda';

import { VendorsBalanceSummaryTable } from './VendorsBalanceSummaryTable';
import { FinancialSheetSkeleton } from '@/components/FinancialSheet';
import { FinancialReportBody } from '../FinancialReportPage';
import { useVendorsBalanceSummaryContext } from './VendorsBalanceSummaryProvider';

import { withCurrentOrganization, WithCurrentOrganizationProps } from '@/containers/Organization/withCurrentOrganization';

interface VendorsBalanceSummaryBodyJSXProps {
  organizationName: WithCurrentOrganizationProps['organization'];
}

/**
 * Vendor balance summary body.
 * @returns {JSX.Element}
 */
function VendorsBalanceSummaryBodyJSX({
  // #withCurrentOrganization
  organizationName,
}: VendorsBalanceSummaryBodyJSXProps) {
  const { isVendorsBalanceLoading } = useVendorsBalanceSummaryContext();

  return (
    <FinancialReportBody>
      {isVendorsBalanceLoading ? (
        <FinancialSheetSkeleton />
      ) : (
        <VendorsBalanceSummaryTable organizationName={organizationName} />
      )}
    </FinancialReportBody>
  );
}

export const VendorBalanceSummaryBody = R.compose(
  withCurrentOrganization(({ organization }) => ({
    organizationName: organization.name,
  })),
)(VendorsBalanceSummaryBodyJSX);
