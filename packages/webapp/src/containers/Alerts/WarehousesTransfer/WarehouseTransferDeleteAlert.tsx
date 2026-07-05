// @ts-nocheck
import { Intent, Alert } from '@blueprintjs/core';
import React from 'react';
import intl from 'react-intl-universal';
import {
  AppToaster,
  FormattedMessage as T,
  FormattedHTMLMessage,
} from '@/components';
import { DRAWERS } from '@/constants/drawers';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withAlertStoreConnect } from '@/containers/Alert/withAlertStoreConnect';
import { withDrawerActions } from '@/containers/Drawer/withDrawerActions';
import { useDeleteWarehouseTransfer } from '@/hooks/query';
import { compose } from '@/utils';

/**
 * Warehouse transfer delete alert
 * @returns
 */
function WarehouseTransferDeleteAlertInner({
  name,

  // #withAlertStoreConnect
  isOpen,
  payload: { warehouseTransferId },

  // #withAlertActions
  closeAlert,

  // #withDrawerActions
  closeDrawer,
}) {
  const { mutateAsync: deleteWarehouseTransferMutate, isLoading } =
    useDeleteWarehouseTransfer();

  // handle cancel delete warehouse alert.
  const handleCancelDeleteAlert = () => {
    closeAlert(name);
  };

  // handleConfirm delete warehouse transfer.
  const handleConfirmWarehouseTransferDelete = () => {
    deleteWarehouseTransferMutate(warehouseTransferId)
      .then(() => {
        AppToaster.show({
          message: intl.get('warehouse_transfer.alert.delete_message'),
          intent: Intent.SUCCESS,
        });
        closeDrawer(DRAWERS.WAREHOUSE_TRANSFER_DETAILS);
      })
      .catch(({ data: { errors } }) => {})
      .finally(() => {
        closeAlert(name);
      });
  };

  return (
    <Alert
      cancelButtonText={<T id={'cancel'} />}
      confirmButtonText={<T id={'delete'} />}
      icon="trash"
      intent={Intent.DANGER}
      isOpen={isOpen}
      onCancel={handleCancelDeleteAlert}
      onConfirm={handleConfirmWarehouseTransferDelete}
      loading={isLoading}
    >
      <p>
        <FormattedHTMLMessage
          id={'warehouse_transfer.once_delete_this_warehouse_transfer'}
        />
      </p>
    </Alert>
  );
}

export const WarehouseTransferDeleteAlert = compose(
  withAlertStoreConnect(),
  withAlertActions,
  withDrawerActions,
)(WarehouseTransferDeleteAlertInner);
