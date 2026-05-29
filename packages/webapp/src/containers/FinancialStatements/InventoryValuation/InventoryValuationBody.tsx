import React from 'react';

import { InventoryValuationTable } from './InventoryValuationTable';
import { useInventoryValuationContext } from './InventoryValuationProvider';

import { FinancialReportBody } from '../FinancialReportPage';
import { FinancialSheetSkeleton } from '@/components';
import { withCurrentOrganization, WithCurrentOrganizationProps } from '@/containers/Organization/withCurrentOrganization';
import { compose } from '@/utils';

interface InventoryValuationBodyProps {
  organizationName: WithCurrentOrganizationProps['organization'];
}

/**
 * Inventory valuation body.
 * @returns {JSX.Element}
 */
function InventoryValuationBodyJSX({ organizationName }: InventoryValuationBodyProps) {
  const { isLoading } = useInventoryValuationContext();

  return (
    <FinancialReportBody>
      {isLoading ? (
        <FinancialSheetSkeleton />
      ) : (
        <InventoryValuationTable companyName={organizationName} />
      )}
    </FinancialReportBody>
  );
}

export const InventoryValuationBody = compose(
  withCurrentOrganization(({ organization }) => ({
    organizationName: organization.name,
  })),
)(InventoryValuationBodyJSX);
