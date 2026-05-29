import React from 'react';

import { BalanceSheetTable } from './BalanceSheetTable';
import {
  withCurrentOrganization,
  WithCurrentOrganizationProps,
} from '@/containers/Organization/withCurrentOrganization';

import { FinancialReportBody } from '../FinancialReportPage';
import { useBalanceSheetContext } from './BalanceSheetProvider';
import { FinancialSheetSkeleton } from '@/components';
import { compose } from '@/utils';

interface BalanceSheetBodyProps {
  organizationName: WithCurrentOrganizationProps['organization'];
}

function BalanceSheetBodyJSX({ organizationName }: BalanceSheetBodyProps) {
  const { isLoading } = useBalanceSheetContext();

  return (
    <FinancialReportBody>
      {isLoading ? (
        <FinancialSheetSkeleton />
      ) : (
        <BalanceSheetTable companyName={organizationName} />
      )}
    </FinancialReportBody>
  );
}

export const BalanceSheetBody = compose(
  withCurrentOrganization(({ organization }) => ({
    organizationName: organization.name,
  })),
)(BalanceSheetBodyJSX);
