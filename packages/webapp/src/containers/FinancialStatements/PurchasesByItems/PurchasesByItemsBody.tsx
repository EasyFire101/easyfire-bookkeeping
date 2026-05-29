import React from 'react';
import * as R from 'ramda';

import { PurchasesByItemsTable } from './PurchasesByItemsTable';
import { FinancialReportBody } from '../FinancialReportPage';
import { FinancialSheetSkeleton } from '@/components';
import { usePurchaseByItemsContext } from './PurchasesByItemsProvider';

import { withCurrentOrganization, WithCurrentOrganizationProps } from '@/containers/Organization/withCurrentOrganization';

interface PurchasesByItemsBodyJSXProps {
  organizationName: WithCurrentOrganizationProps['organization'];
}

/**
 * Purchases by items.
 */
function PurchasesByItemsBodyJSX({
  organizationName,
}: PurchasesByItemsBodyJSXProps) {
  const { isLoading } = usePurchaseByItemsContext();

  return (
    <FinancialReportBody>
      {isLoading ? (
        <FinancialSheetSkeleton />
      ) : (
        <PurchasesByItemsTable companyName={organizationName?.name} />
      )}
    </FinancialReportBody>
  );
}

export const PurchasesByItemsBody = R.compose(
  withCurrentOrganization(({ organization }) => ({
    organizationName: organization,
  })),
)(PurchasesByItemsBodyJSX);
