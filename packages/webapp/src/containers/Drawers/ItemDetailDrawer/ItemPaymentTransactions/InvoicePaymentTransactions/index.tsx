import React from 'react';
import { useHistory } from 'react-router-dom';
import { DataTable, TableSkeletonRows } from '@/components';
import { useItemAssociatedInvoiceTransactions } from '@/hooks/query';
import { useItemDetailDrawerContext } from '../../ItemDetailDrawerProvider';
import {
  useInvoicePaymentTransactionsColumns,
  ActionsMenu,
  type ItemInvoiceTransaction,
} from './components';
import { TableStyle } from '@/constants';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withDrawerActions } from '@/containers/Drawer/withDrawerActions';
import { compose } from '@/utils';
import { DRAWERS } from '@/constants/drawers';
import type { WithAlertActionsProps } from '@/containers/Alert/withAlertActions';
import type { WithDrawerActionsProps } from '@/containers/Drawer/withDrawerActions';

interface InvoicePaymentTransactionsInnerProps
  extends Pick<WithAlertActionsProps, 'openAlert'>,
    Pick<WithDrawerActionsProps, 'closeDrawer'> {}

/**
 * Invoice payment transactions.
 */
function InvoicePaymentTransactions({
  openAlert,
  closeDrawer,
}: InvoicePaymentTransactionsInnerProps) {
  const history = useHistory();
  const columns = useInvoicePaymentTransactionsColumns();
  const { itemId } = useItemDetailDrawerContext();

  const {
    isLoading: isInvoiceTransactionsLoading,
    isFetching: isInvoiceTransactionFetching,
    data: paymentTransactions,
  } = useItemAssociatedInvoiceTransactions(itemId, {
    enabled: !!itemId,
  });

  const handleDeletePaymentTransactons = ({
    invoiceId,
  }: ItemInvoiceTransaction) => {
    openAlert('invoice-delete', {
      invoiceId,
    });
  };

  const handleEditPaymentTransactions = ({
    invoiceId,
  }: ItemInvoiceTransaction) => {
    history.push(`/invoices/${invoiceId}/edit`);
    closeDrawer(DRAWERS.ITEM_DETAILS);
  };
  return (
    <DataTable
      columns={columns}
      data={paymentTransactions ?? []}
      loading={isInvoiceTransactionsLoading}
      headerLoading={isInvoiceTransactionsLoading}
      progressBarLoading={isInvoiceTransactionFetching}
      ContextMenu={ActionsMenu}
      payload={{
        onEdit: handleEditPaymentTransactions,
        onDelete: handleDeletePaymentTransactons,
      }}
      styleName={TableStyle.Constrant}
      TableLoadingRenderer={TableSkeletonRows}
      sticky={true}
    />
  );
}

export const index = compose(
  withAlertActions,
  withDrawerActions,
)(InvoicePaymentTransactions);
