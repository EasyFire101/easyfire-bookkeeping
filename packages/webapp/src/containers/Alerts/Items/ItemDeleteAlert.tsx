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
import { handleDeleteErrors } from '@/containers/Items/utils';
import { withItemsActions } from '@/containers/Items/withItemsActions';
import { useDeleteItem } from '@/hooks/query';
import { compose } from '@/utils';

/**
 * Item delete alerts.
 */
function ItemDeleteAlertInner({
  name,

  // #withAlertStoreConnect
  isOpen,
  payload: { itemId },

  // #withAlertActions
  closeAlert,

  // #withItemsActions
  setItemsTableState,

  // #withDrawerActions
  closeDrawer,
}) {
  const { mutateAsync: deleteItem, isLoading } = useDeleteItem();

  // Handle cancel delete item alert.
  const handleCancelItemDelete = () => {
    closeAlert(name);
  };

  // Handle confirm delete item.
  const handleConfirmDeleteItem = () => {
    deleteItem(itemId)
      .then(() => {
        AppToaster.show({
          message: intl.get('the_item_has_been_deleted_successfully'),
          intent: Intent.SUCCESS,
        });
        // Reset to page number one.
        setItemsTableState({ page: 1 });
        closeDrawer(DRAWERS.ITEM_DETAILS);
      })
      .catch(({ data: { errors } }) => {
        handleDeleteErrors(errors);
      })
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
      onCancel={handleCancelItemDelete}
      onConfirm={handleConfirmDeleteItem}
      loading={isLoading}
    >
      <p>
        <FormattedHTMLMessage
          id={'once_delete_this_item_you_will_able_to_restore_it'}
        />
      </p>
    </Alert>
  );
}

export const ItemDeleteAlert = compose(
  withAlertStoreConnect(),
  withAlertActions,
  withItemsActions,
  withDrawerActions,
)(ItemDeleteAlertInner);
