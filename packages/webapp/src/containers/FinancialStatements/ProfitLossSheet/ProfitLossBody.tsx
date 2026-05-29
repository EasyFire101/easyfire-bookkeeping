import React from 'react';
import * as R from 'ramda';

import { ProfitLossSheetTable } from './ProfitLossSheetTable';
import { FinancialSheetSkeleton } from '@/components';
import { FinancialReportBody } from '../FinancialReportPage';
import { useProfitLossSheetContext } from './ProfitLossProvider';

import {
  withCurrentOrganization,
  WithCurrentOrganizationProps,
} from '@/containers/Organization/withCurrentOrganization';

import { compose } from '@/utils';

interface ProfitLossBodyProps {
  organizationName: WithCurrentOrganizationProps['organization'];
}

function ProfitLossBodyJSX({ organizationName }: ProfitLossBodyProps) {
  const { isLoading } = useProfitLossSheetContext();

  return (
    <FinancialReportBody>
      {isLoading ? (
        <FinancialSheetSkeleton />
      ) : (
        <ProfitLossSheetTable companyName={organizationName} />
      )}
    </FinancialReportBody>
  );
}

export const ProfitLossBody = compose(
  withCurrentOrganization(({ organization }) => ({
    organizationName: organization.name,
  })),
)(ProfitLossBodyJSX);
