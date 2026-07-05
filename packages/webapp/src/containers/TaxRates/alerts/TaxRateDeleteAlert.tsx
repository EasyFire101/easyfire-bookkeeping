// @ts-nocheck
import { Intent, Alert } from '@blueprintjs/core';
import React from 'react';
import { AppToaster, FormattedMessage as T } from '@/components';
import { DRAWERS } from '@/constants/drawers';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withAlertStoreConnect } from '@/containers/Alert/withAlertStoreConnect';
import { withDrawerActions } from '@/containers/Drawer/withDrawerActions';
import { useDeleteTaxRate } from '@/hooks/query/tax-rates';
import { compose } from '@/utils';

/**
 * Item delete alerts.
 */
function TaxRateDeleteAlertInner({
  name,

  // #withAlertStoreConnect
  isOpen,
  payload: { taxRateId },

  // #withAlertActions
  closeAlert,

  // #withDrawerActions
  closeDrawer,
}) {
  const { mutateAsync: deleteTaxRate, isLoading } = useDeleteTaxRate();

  // Handle cancel delete item alert.
  const handleCancelItemDelete = () => {
    closeAlert(name);
  };
  // Handle confirm delete item.
  const handleConfirmDeleteItem = () => {
    deleteTaxRate(taxRateId)
      .then(() => {
        AppToaster.show({
          message: 'The tax rate has been deleted successfully.',
          intent: Intent.SUCCESS,
        });
        closeDrawer(DRAWERS.TAX_RATE_DETAILS);
      })
      .catch(({ data: { errors } }) => {
        AppToaster.show({
          message: 'Something went wrong.',
          intent: Intent.DANGER,
        });
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
        Once you delete this tax rate, you won't be able to restore the item
        later.
      </p>

      <p>
        Are you sure you want to delete ? If you're not sure, you can inactivate
        it instead.
      </p>
    </Alert>
  );
}

export const TaxRateDeleteAlert = compose(
  withAlertStoreConnect(),
  withAlertActions,
  withDrawerActions,
)(TaxRateDeleteAlertInner);
