import React, { useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import { compose } from '@/utils';
import { TABLES } from '@/constants/tables';
import {
  DataTable,
  DashboardContentTable,
  TableSkeletonRows,
  TableSkeletonHeader,
} from '@/components';
import { PaymentsReceivedEmptyStatus as PaymentReceivesEmptyStatus } from './PaymentsReceivedEmptyStatus';
import { withPaymentsReceived } from './withPaymentsReceived';
import { withPaymentsReceivedActions } from './withPaymentsReceivedActions';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withDrawerActions } from '@/containers/Drawer/withDrawerActions';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { withSettings } from '@/containers/Settings/withSettings';
import { usePaymentReceivesColumns, ActionsMenu } from './components';
import { usePaymentsReceivedListContext } from './PaymentsReceivedListProvider';
import { useMemorizedColumnsWidths } from '@/hooks';
import { DRAWERS } from '@/constants/drawers';
import type { WithPaymentsReceivedProps } from './withPaymentsReceived';
import type { WithAlertActionsProps } from '@/containers/Alert/withAlertActions';
import type { WithDrawerActionsProps } from '@/containers/Drawer/withDrawerActions';
import type { WithDialogActionsProps } from '@/containers/Dialog/withDialogActions';
import type { PaymentReceiveTableRow } from './components';

interface WithPaymentsReceivedActionsProps {
  setPaymentReceivesTableState: (state: Record<string, any>) => void;
  setPaymentReceivesSelectedRows: (ids: number[]) => void;
}

interface WithSettingsProps {
  paymentReceivesTableSize?: string | null;
}

interface PaymentsReceivedDataTableProps
  extends Pick<WithPaymentsReceivedProps, 'paymentReceivesTableState'>,
    WithPaymentsReceivedActionsProps,
    WithAlertActionsProps,
    WithDrawerActionsProps,
    WithDialogActionsProps,
    WithSettingsProps {}

function PaymentsReceivedDataTable({
  setPaymentReceivesTableState,
  setPaymentReceivesSelectedRows,
  paymentReceivesTableState,
  openAlert,
  openDrawer,
  openDialog,
  paymentReceivesTableSize,
}: PaymentsReceivedDataTableProps) {
  const history = useHistory();

  const {
    paymentReceives,
    pagination,
    isPaymentReceivesLoading,
    isPaymentReceivesFetching,
    isEmptyStatus,
  } = usePaymentsReceivedListContext();

  const columns = usePaymentReceivesColumns();

  const handleEditPaymentReceive = ({ id }: PaymentReceiveTableRow) => {
    history.push(`/payments-received/${id}/edit`);
  };

  const handleDeletePaymentReceive = ({ id }: PaymentReceiveTableRow) => {
    openAlert('payment-received-delete', { paymentReceiveId: id });
  };

  const handleViewDetailPaymentReceive = ({ id }: PaymentReceiveTableRow) => {
    openDrawer(DRAWERS.PAYMENT_RECEIVED_DETAILS, { paymentReceiveId: id });
  };

  const handleSendMailPayment = ({ id }: PaymentReceiveTableRow) => {
    openDrawer(DRAWERS.PAYMENT_RECEIVED_SEND_MAIL, { paymentReceivedId: id });
  };

  const handleCellClick = (cell: any, _event: React.MouseEvent) => {
    openDrawer(DRAWERS.PAYMENT_RECEIVED_DETAILS, {
      paymentReceiveId: cell.row.original.id,
    });
  };

  const [initialColumnsWidths, , handleColumnResizing] =
    useMemorizedColumnsWidths(TABLES.PAYMENT_RECEIVES);

  const handleDataTableFetchData = useCallback(
    ({
      pageIndex,
      pageSize,
      sortBy,
    }: {
      pageSize: number;
      pageIndex: number;
      sortBy: Array<{ id: string; desc: boolean }>;
    }) => {
      setPaymentReceivesTableState({
        pageIndex,
        pageSize,
        sortBy,
      });
    },
    [setPaymentReceivesTableState],
  );

  const handleSelectedRowsChange = (
    selectedRows: Array<{ original: PaymentReceiveTableRow }>,
  ) => {
    const selectedIds = selectedRows?.map((row) => row.original.id) || [];
    setPaymentReceivesSelectedRows(selectedIds);
  };

  if (isEmptyStatus) {
    return <PaymentReceivesEmptyStatus />;
  }

  return (
    <DashboardContentTable>
      <DataTable
        columns={columns}
        data={paymentReceives ?? []}
        loading={isPaymentReceivesLoading}
        headerLoading={isPaymentReceivesLoading}
        progressBarLoading={isPaymentReceivesFetching}
        onFetchData={handleDataTableFetchData}
        manualSortBy={true}
        selectionColumn={true}
        noInitialFetch={true}
        sticky={true}
        autoResetSortBy={false}
        autoResetPage={false}
        pagination={true}
        onSelectedRowsChange={handleSelectedRowsChange}
        initialPageSize={paymentReceivesTableState?.pageSize ?? 10}
        rowsCount={pagination?.total ?? 0}
        TableLoadingRenderer={TableSkeletonRows}
        TableHeaderSkeletonRenderer={TableSkeletonHeader}
        ContextMenu={ActionsMenu}
        onCellClick={handleCellClick}
        initialColumnsWidths={initialColumnsWidths}
        onColumnResizing={handleColumnResizing}
        size={paymentReceivesTableSize}
        payload={{
          onDelete: handleDeletePaymentReceive,
          onEdit: handleEditPaymentReceive,
          onViewDetails: handleViewDetailPaymentReceive,
          onSendMail: handleSendMailPayment,
        }}
      />
    </DashboardContentTable>
  );
}

export const PaymentsReceivedTable = compose(
  withPaymentsReceivedActions,
  withAlertActions,
  withDrawerActions,
  withDialogActions,
  withPaymentsReceived(({ paymentReceivesTableState }) => ({
    paymentReceivesTableState,
  })),
  withSettings(({ paymentReceiveSettings }: any) => ({
    paymentReceivesTableSize: paymentReceiveSettings?.tableSize,
  })),
)(PaymentsReceivedDataTable);
