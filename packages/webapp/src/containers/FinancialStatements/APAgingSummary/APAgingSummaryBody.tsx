import React from 'react';

import { APAgingSummaryTable } from './APAgingSummaryTable';
import { FinancialReportBody } from '../FinancialReportPage';
import { FinancialSheetSkeleton } from '@/components/FinancialSheet';
import { useAPAgingSummaryContext } from './APAgingSummaryProvider';

import { useCurrentOrganizationName } from '@/hooks/query';

function APAgingSummaryBodyJSX() {
  const organizationName = useCurrentOrganizationName();
  const { isAPAgingLoading } = useAPAgingSummaryContext();

  return (
    <FinancialReportBody>
      {isAPAgingLoading ? (
        <FinancialSheetSkeleton />
      ) : (
        <APAgingSummaryTable organizationName={organizationName} />
      )}
    </FinancialReportBody>
  );
}

export const APAgingSummaryBody = APAgingSummaryBodyJSX;
