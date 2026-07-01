import React, { useEffect } from 'react';
import { DashboardPageContent } from '@/components';
import '@/style/pages/Bills/List.scss';
import { BillsListProvider } from './BillsListProvider';
import { BillsActionsBar } from './BillsActionsBar';
import { BillsTable } from './BillsTable';
import { BillsListDrawers } from './BillsListDrawers';
import { BillsListDialogs } from './BillsListDialogs';
import { withBills } from './withBills';
import { withBillsActions } from './withBillsActions';
import { transformTableStateToQuery, compose } from '@/utils';
import type { WithBillsProps } from './withBills';

interface WithBillsActionsProps {
  resetBillsTableState: () => void;
}

interface BillsListProps
  extends Pick<WithBillsProps, 'billsTableState' | 'billsTableStateChanged'>,
    WithBillsActionsProps {}

function BillsListInner({
  billsTableState,
  billsTableStateChanged,
  resetBillsTableState,
}: BillsListProps) {
  useEffect(
    () => () => {
      resetBillsTableState();
    },
    [resetBillsTableState],
  );

  return (
    <BillsListProvider
      query={transformTableStateToQuery(billsTableState)}
      tableStateChanged={billsTableStateChanged}
    >
      <BillsActionsBar />
      <BillsListDrawers />
      <BillsListDialogs />

      <DashboardPageContent>
        <BillsTable />
      </DashboardPageContent>
    </BillsListProvider>
  );
}

export const BillsList = compose(
  withBills(({ billsTableState, billsTableStateChanged }) => ({
    billsTableState,
    billsTableStateChanged,
  })),
  withBillsActions,
)(BillsListInner);
