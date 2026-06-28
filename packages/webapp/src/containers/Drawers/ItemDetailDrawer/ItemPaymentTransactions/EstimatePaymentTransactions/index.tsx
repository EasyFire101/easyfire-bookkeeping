import React from 'react';
import { useHistory } from 'react-router-dom';
import { DataTable, TableSkeletonRows } from '@/components';
import { TableStyle } from '@/constants';
import { useItemDetailDrawerContext } from '../../ItemDetailDrawerProvider';
import { useItemAssociatedEstimateTransactions } from '@/hooks/query';
import {
  useEstimateTransactionsColumns,
  ActionsMenu,
  type ItemEstimateTransaction,
} from './components';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withDrawerActions } from '@/containers/Drawer/withDrawerActions';
import { compose } from '@/utils';
import { DRAWERS } from '@/constants/drawers';
import type { WithAlertActionsProps } from '@/containers/Alert/withAlertActions';
import type { WithDrawerActionsProps } from '@/containers/Drawer/withDrawerActions';

interface EstimatePaymentTransactionsInnerProps
  extends Pick<WithAlertActionsProps, 'openAlert'>,
    Pick<WithDrawerActionsProps, 'closeDrawer'> {}

/**
 * Estimate payment transactions.
 */
function EstimatePaymentTransactions({
  openAlert,
  closeDrawer,
}: EstimatePaymentTransactionsInnerProps) {
  const history = useHistory();
  const columns = useEstimateTransactionsColumns();
  const { itemId } = useItemDetailDrawerContext();

  const {
    isLoading: isEstimateTransactionsLoading,
    isFetching: isEstimateTransactionFetching,
    data: paymentTransactions,
  } = useItemAssociatedEstimateTransactions(itemId, {
    enabled: !!itemId,
  });

  const handleDeletePaymentTransactons = ({
    estimateId,
  }: ItemEstimateTransaction) => {
    openAlert('estimate-delete', {
      estimateId,
    });
  };

  const handleEditPaymentTransactions = ({
    estimateId,
  }: ItemEstimateTransaction) => {
    history.push(`/estimates/${estimateId}/edit`);
    closeDrawer(DRAWERS.ITEM_DETAILS);
  };

  return (
    <DataTable
      columns={columns}
      data={paymentTransactions ?? []}
      loading={isEstimateTransactionsLoading}
      headerLoading={isEstimateTransactionsLoading}
      progressBarLoading={isEstimateTransactionFetching}
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
)(EstimatePaymentTransactions);
