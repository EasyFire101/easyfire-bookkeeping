import React from 'react';

import { useInventoryItemDetailsContext } from './InventoryItemDetailsProvider';
import { InventoryItemDetailsTable } from './InventoryItemDetailsTable';

import { FinancialReportBody } from '../FinancialReportPage';
import { FinancialSheetSkeleton } from '@/components';
import { withCurrentOrganization, WithCurrentOrganizationProps } from '@/containers/Organization/withCurrentOrganization';
import { compose } from '@/utils';

interface InventoryItemDetailsBodyProps {
  organizationName: WithCurrentOrganizationProps['organization'];
}

/**
 * Inventory item details body.
 * @returns {JSX.Element}
 */
function InventoryItemDetailsBodyJSX({ organizationName }: InventoryItemDetailsBodyProps) {
  const { isInventoryItemDetailsLoading } = useInventoryItemDetailsContext();

  return (
    <FinancialReportBody>
      {isInventoryItemDetailsLoading ? (
        <FinancialSheetSkeleton />
      ) : (
        <InventoryItemDetailsTable companyName={organizationName} />
      )}
    </FinancialReportBody>
  );
}

export const InventoryItemDetailsBody = compose(
  withCurrentOrganization(({ organization }) => ({
    organizationName: organization.name,
  })),
)(InventoryItemDetailsBodyJSX);
