import React from 'react';
import '@/style/pages/SaleInvoice/List.scss';
import { DashboardPageContent } from '@/components';
import { InvoicesListProvider } from './InvoicesListProvider';
import { InvoicesDataTable } from './InvoicesDataTable';
import { InvoicesActionsBar } from './InvoicesActionsBar';
import { InvoicesListDrawers } from './InvoicesListDrawers';
import { InvoicesListDialogs } from './InvoicesListDialogs';
import { withInvoices } from './withInvoices';
import { withInvoiceActions } from './withInvoiceActions';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { transformTableStateToQuery, compose } from '@/utils';
import type { WithInvoicesProps } from './withInvoices';

interface WithInvoiceActionsProps {
  resetInvoicesTableState: () => void;
}

interface InvoicesListProps
  extends Pick<WithInvoicesProps, 'invoicesTableState' | 'invoicesTableStateChanged'>,
    WithInvoiceActionsProps {}

function InvoicesListInner({
  invoicesTableState,
  invoicesTableStateChanged,
  resetInvoicesTableState,
}: InvoicesListProps) {
  React.useEffect(
    () => () => {
      resetInvoicesTableState();
    },
    [resetInvoicesTableState],
  );

  return (
    <InvoicesListProvider
      query={transformTableStateToQuery(invoicesTableState)}
      tableStateChanged={invoicesTableStateChanged}
    >
      <InvoicesActionsBar />
      <InvoicesListDrawers />
      <InvoicesListDialogs />

      <DashboardPageContent>
        <InvoicesDataTable />
      </DashboardPageContent>
    </InvoicesListProvider>
  );
}

export const InvoicesList = compose(
  withInvoices(({ invoicesTableState, invoicesTableStateChanged }) => ({
    invoicesTableState,
    invoicesTableStateChanged,
  })),
  withInvoiceActions,
  withAlertActions,
)(InvoicesListInner);
