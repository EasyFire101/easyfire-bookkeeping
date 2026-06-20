import React from 'react';

import { CashFlowStatementTable } from './CashFlowStatementTable';
import { FinancialReportBody } from '../FinancialReportPage';
import { FinancialSheetSkeleton } from '@/components/FinancialSheet';

import { useCashFlowStatementContext } from './CashFlowStatementProvider';
import { useCurrentOrganizationName } from '@/hooks/query';

function CashFlowStatementBodyJSX() {
  const organizationName = useCurrentOrganizationName();
  const { isCashFlowLoading } = useCashFlowStatementContext();

  return (
    <FinancialReportBody>
      {isCashFlowLoading ? (
        <FinancialSheetSkeleton />
      ) : (
        <CashFlowStatementTable companyName={organizationName} />
      )}
    </FinancialReportBody>
  );
}

export const CashFlowStatementBody = CashFlowStatementBodyJSX;
