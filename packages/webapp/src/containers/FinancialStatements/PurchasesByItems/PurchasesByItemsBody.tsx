import React from 'react';
import { PurchasesByItemsTable } from './PurchasesByItemsTable';
import { FinancialReportBody } from '../FinancialReportPage';
import { FinancialSheetSkeleton } from '@/components';
import { usePurchaseByItemsContext } from './PurchasesByItemsProvider';
import { useCurrentOrganizationName } from '@/hooks/query';

/**
 * Purchases by items.
 */
function PurchasesByItemsBodyJSX() {
  const organizationName = useCurrentOrganizationName();
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

export const PurchasesByItemsBody = PurchasesByItemsBodyJSX;
