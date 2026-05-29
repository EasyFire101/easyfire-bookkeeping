import React, { useMemo } from 'react';
import styled from 'styled-components';
import intl from 'react-intl-universal';

import { TableStyle } from '@/constants';
import { ReportDataTable, FinancialSheet } from '@/components';
import { useProjectProfitabilitySummaryContext } from './ProjectProfitabilitySummaryProvider';
import { useProjectProfitabilitySummaryColumns } from './components';
import { defaultExpanderReducer, tableRowTypesToClassnames } from '@/utils';

interface ProjectProfitabilitySummaryTableProps {
  companyName: string;
}

/**
 * Project profitability summary table.
 */
export function ProjectProfitabilitySummaryTable({
  // #ownProps
  companyName,
}: ProjectProfitabilitySummaryTableProps) {
  // Project profitability summary context.
  const {
    projectProfitabilitySummary,
    query,
  } = useProjectProfitabilitySummaryContext();

  const tableRows = (projectProfitabilitySummary as any)?.tableRows;
  const meta = (projectProfitabilitySummary as any)?.meta;

  // Retrieve the database columns.
  const tableColumns = useProjectProfitabilitySummaryColumns();

  return (
    <FinancialSheet
      companyName={companyName}
      sheetType={intl.get('project_profitability_summary')}
      dateText={meta?.formatted_date_range ?? meta?.formatted_as_date}
      basis={query.basis}
      name="project-profitability-summary"
    >
      <ProjectProfitabilitySummaryDataTable
        columns={tableColumns}
        data={tableRows}
        rowClassNames={tableRowTypesToClassnames}
        noInitialFetch={true}
        sticky={true}
        styleName={TableStyle.Constrant}
      />
    </FinancialSheet>
  );
}

const ProjectProfitabilitySummaryDataTable = styled(ReportDataTable)`
  .table {
    .tbody .tr {
      .td {
        border-bottom: 0;
        padding-top: 0.32rem;
        padding-bottom: 0.32rem;
      }
      &.row_type--TOTAL .td {
        border-top: 1px solid #bbb;
        font-weight: 500;
        border-bottom: 3px double #000;
      }
      &:last-of-type .td {
        border-bottom: 1px solid #bbb;
      }
    }
  }
`;
