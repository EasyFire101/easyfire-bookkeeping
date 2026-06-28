import React from 'react';
import { useHistory } from 'react-router-dom';
import { TableStyle } from '@/constants';
import { DataTable, TableSkeletonRows } from '@/components';
import { useItemDetailDrawerContext } from '../../ItemDetailDrawerProvider';
import { useItemAssociatedReceiptTransactions } from '@/hooks/query';
import {
  useReceiptTransactionsColumns,
  ActionsMenu,
  type ItemReceiptTransaction,
} from './components';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withDrawerActions } from '@/containers/Drawer/withDrawerActions';
import { compose } from '@/utils';
import { DRAWERS } from '@/constants/drawers';
import type { WithAlertActionsProps } from '@/containers/Alert/withAlertActions';
import type { WithDrawerActionsProps } from '@/containers/Drawer/withDrawerActions';

interface ReceiptPaymentTransactionsInnerProps
  extends Pick<WithAlertActionsProps, 'openAlert'>,
    Pick<WithDrawerActionsProps, 'closeDrawer'> {}

/**
 * Receipt payment transactions.
 */
function ReceiptPaymentTransactions({
  openAlert,
  closeDrawer,
}: ReceiptPaymentTransactionsInnerProps) {
  const history = useHistory();
  const columns = useReceiptTransactionsColumns();
  const { itemId } = useItemDetailDrawerContext();
  const {
    isLoading: isReceiptTransactionsLoading,
    isFetching: isReceiptTransactionFetching,
    data: paymentTransactions,
  } = useItemAssociatedReceiptTransactions(itemId, {
    enabled: !!itemId,
  });

  const handleDeletePaymentTransactons = ({
    receiptId,
  }: ItemReceiptTransaction) => {
    openAlert('receipt-delete', {
      receiptId,
    });
  };

  const handleEditPaymentTransactions = ({
    receiptId,
  }: ItemReceiptTransaction) => {
    history.push(`/receipts/${receiptId}/edit`);
    closeDrawer(DRAWERS.ITEM_DETAILS);
  };

  return (
    <DataTable
      columns={columns}
      data={paymentTransactions ?? []}
      loading={isReceiptTransactionsLoading}
      headerLoading={isReceiptTransactionsLoading}
      progressBarLoading={isReceiptTransactionFetching}
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
)(ReceiptPaymentTransactions);
