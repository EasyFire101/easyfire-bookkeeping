import React from 'react';
import { pipe } from 'fp-ts/function';
import { PurchasesByItemsTable } from './PurchasesByItemsTable';
import { FinancialReportBody } from '../FinancialReportPage';
import { FinancialSheetSkeleton } from '@/components';
import { usePurchaseByItemsContext } from './PurchasesByItemsProvider';
import {
  withCurrentOrganization,
  WithCurrentOrganizationProps,
} from '@/containers/Organization/withCurrentOrganization';

interface PurchasesByItemsBodyJSXProps {
  organizationName: WithCurrentOrganizationProps['organization']['name'];
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
        <PurchasesByItemsTable companyName={organizationName} />
      )}
    </FinancialReportBody>
  );
}

export const PurchasesByItemsBody = pipe(
  PurchasesByItemsBodyJSX,
  withCurrentOrganization(({ organization }) => ({
    organizationName: organization.name,
  })),
);
