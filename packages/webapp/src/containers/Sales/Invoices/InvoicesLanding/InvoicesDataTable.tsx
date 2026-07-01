import React, { useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import { InvoicesEmptyStatus } from './InvoicesEmptyStatus';
import { TABLES } from '@/constants/tables';
import {
  DataTable,
  DashboardContentTable,
  TableSkeletonHeader,
  TableSkeletonRows,
} from '@/components';
import { withInvoices } from './withInvoices';
import { withInvoiceActions } from './withInvoiceActions';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withDrawerActions } from '@/containers/Drawer/withDrawerActions';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { withDashboardActions } from '@/containers/Dashboard/withDashboardActions';
import { withSettings } from '@/containers/Settings/withSettings';
import { useMemorizedColumnsWidths } from '@/hooks';
import { useInvoicesTableColumns, ActionsMenu } from './components';
import { useInvoicesListContext } from './InvoicesListProvider';
import { compose } from '@/utils';
import { DRAWERS } from '@/constants/drawers';
import type { WithDialogActionsProps } from '@/containers/Dialog/withDialogActions';
import type { InvoiceTableRow } from './components';
import type { WithDrawerActionsProps } from '@/containers/Drawer/withDrawerActions';
import type { WithAlertActionsProps } from '@/containers/Alert/withAlertActions';
import type { WithInvoicesProps } from './withInvoices';

interface WithInvoiceActionsProps {
  setInvoicesTableState: (state: Record<string, any>) => void;
  setInvoicesSelectedRows: (ids: number[]) => void;
}

interface WithSettingsProps {
  invoicesTableSize?: string | null;
}

interface InvoicesDataTableProps
  extends Pick<WithInvoicesProps, 'invoicesTableState'>,
    WithInvoiceActionsProps,
    WithAlertActionsProps,
    WithDrawerActionsProps,
    WithDialogActionsProps,
    WithSettingsProps {}

function InvoicesDataTableInner({
  setInvoicesTableState,
  setInvoicesSelectedRows,
  invoicesTableState,
  openAlert,
  openDrawer,
  openDialog,
  invoicesTableSize,
}: InvoicesDataTableProps) {
  const history = useHistory();

  const {
    invoices,
    pagination,
    isEmptyStatus,
    isInvoicesLoading,
    isInvoicesFetching,
  } = useInvoicesListContext();

  const columns = useInvoicesTableColumns();

  const handleDeleteInvoice = ({ id }: InvoiceTableRow) => {
    openAlert('invoice-delete', { invoiceId: id });
  };

  const handleDeliverInvoice = ({ id }: InvoiceTableRow) => {
    openAlert('invoice-deliver', { invoiceId: id });
  };

  const handleEditInvoice = (invoice: InvoiceTableRow) => {
    history.push(`/invoices/${invoice.id}/edit`);
  };

  const handleConvertToCreitNote = ({ id }: InvoiceTableRow) => {
    history.push(`/credit-notes/new?from_invoice_id=${id}`, { invoiceId: id });
  };

  const handleQuickPaymentReceive = ({ id }: InvoiceTableRow) => {
    openDialog('quick-payment-receive', { invoiceId: id });
  };

  const handleViewDetailInvoice = ({ id }: InvoiceTableRow) => {
    openDrawer(DRAWERS.INVOICE_DETAILS, { invoiceId: id });
  };

  const handlePrintInvoice = ({ id }: InvoiceTableRow) => {
    openDialog('invoice-pdf-preview', { invoiceId: id });
  };

  const handleSendMailInvoice = ({ id }: InvoiceTableRow) => {
    openDrawer(DRAWERS.INVOICE_SEND_MAIL, { invoiceId: id });
  };

  const handleCellClick = (cell: any, _event: React.MouseEvent) => {
    openDrawer(DRAWERS.INVOICE_DETAILS, { invoiceId: cell.row.original.id });
  };

  const [initialColumnsWidths, , handleColumnResizing] =
    useMemorizedColumnsWidths(TABLES.INVOICES);

  const handleDataTableFetchData = useCallback(
    ({
      pageSize,
      pageIndex,
      sortBy,
    }: {
      pageSize: number;
      pageIndex: number;
      sortBy: Array<{ id: string; desc: boolean }>;
    }) => {
      setInvoicesTableState({
        pageSize,
        pageIndex,
        sortBy,
      });
    },
    [setInvoicesTableState],
  );

  const handleSelectedRowsChange = useCallback(
    (selectedFlatRows: Array<{ original: InvoiceTableRow }>) => {
      const selectedIds =
        selectedFlatRows?.map((row) => row.original.id) || [];
      setInvoicesSelectedRows(selectedIds);
    },
    [setInvoicesSelectedRows],
  );

  if (isEmptyStatus) {
    return <InvoicesEmptyStatus />;
  }

  return (
    <DashboardContentTable>
      <DataTable
        columns={columns}
        data={invoices ?? []}
        loading={isInvoicesLoading}
        headerLoading={isInvoicesLoading}
        progressBarLoading={isInvoicesFetching}
        onFetchData={handleDataTableFetchData}
        manualSortBy={true}
        selectionColumn={true}
        onSelectedRowsChange={handleSelectedRowsChange}
        noInitialFetch={true}
        sticky={true}
        pagination={true}
        initialPageSize={invoicesTableState?.pageSize ?? 10}
        manualPagination={true}
        rowsCount={pagination?.total ?? 0}
        autoResetSortBy={false}
        autoResetPage={false}
        autoResetSelectedRows={false}
        TableLoadingRenderer={TableSkeletonRows}
        TableHeaderSkeletonRenderer={TableSkeletonHeader}
        ContextMenu={ActionsMenu}
        onCellClick={handleCellClick}
        initialColumnsWidths={initialColumnsWidths}
        onColumnResizing={handleColumnResizing}
        size={invoicesTableSize}
        payload={{
          onDelete: handleDeleteInvoice,
          onDeliver: handleDeliverInvoice,
          onEdit: handleEditInvoice,
          onQuick: handleQuickPaymentReceive,
          onViewDetails: handleViewDetailInvoice,
          onPrint: handlePrintInvoice,
          onConvert: handleConvertToCreitNote,
          onSendMail: handleSendMailInvoice,
        }}
      />
    </DashboardContentTable>
  );
}

export const InvoicesDataTable = compose(
  withDashboardActions,
  withInvoiceActions,
  withAlertActions,
  withDrawerActions,
  withDialogActions,
  withInvoices(({ invoicesTableState }) => ({ invoicesTableState })),
  withSettings(({ invoiceSettings }) => ({
    invoicesTableSize: invoiceSettings?.tableSize,
  })),
)(InvoicesDataTableInner);
