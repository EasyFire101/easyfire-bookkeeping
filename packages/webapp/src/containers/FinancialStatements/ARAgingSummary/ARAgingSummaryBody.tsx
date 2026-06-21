import React from 'react';

import { ARAgingSummaryTable } from './ARAgingSummaryTable';
import { FinancialReportBody } from '../FinancialReportPage';
import { FinancialSheetSkeleton } from '@/components';
import { useARAgingSummaryContext } from './ARAgingSummaryProvider';

import { useCurrentOrganizationName } from '@/hooks/query';

function ARAgingSummaryBodyJSX() {
  const organizationName = useCurrentOrganizationName();
  const { isARAgingLoading } = useARAgingSummaryContext();

  return (
    <FinancialReportBody>
      {isARAgingLoading ? (
        <FinancialSheetSkeleton />
      ) : (
        <ARAgingSummaryTable organizationName={organizationName} />
      )}
    </FinancialReportBody>
  );
}

export const ARAgingSummaryBody = ARAgingSummaryBodyJSX;
