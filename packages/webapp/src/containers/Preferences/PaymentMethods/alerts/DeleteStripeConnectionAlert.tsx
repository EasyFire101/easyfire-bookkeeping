// @ts-nocheck
import { Intent, Alert } from '@blueprintjs/core';
import React from 'react';
import { AppToaster, FormattedMessage as T } from '@/components';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withAlertStoreConnect } from '@/containers/Alert/withAlertStoreConnect';
import { useDeletePaymentMethod } from '@/hooks/query/payment-services';
import { compose } from '@/utils';

/**
 * Delete Stripe connection alert.
 */
function DeleteStripeAccountAlert({
  name,

  // #withAlertStoreConnect
  isOpen,
  payload: { paymentMethodId },

  // #withAlertActions
  closeAlert,
}) {
  const { isLoading, mutateAsync: deletePaymentMethod } =
    useDeletePaymentMethod();

  // Handle cancel open bill alert.
  const handleCancelOpenBill = () => {
    closeAlert(name);
  };
  // Handle confirm bill open.
  const handleConfirmBillOpen = () => {
    deletePaymentMethod({ paymentMethodId })
      .then(() => {
        AppToaster.show({
          message: 'The Stripe payment account has been deleted.',
          intent: Intent.SUCCESS,
        });
        closeAlert(name);
      })
      .catch((error) => {
        closeAlert(name);
        AppToaster.show({
          message: 'Something went wrong.',
          intent: Intent.SUCCESS,
        });
      });
  };

  return (
    <Alert
      cancelButtonText={<T id={'cancel'} />}
      confirmButtonText={'Delete Account'}
      intent={Intent.DANGER}
      isOpen={isOpen}
      onCancel={handleCancelOpenBill}
      onConfirm={handleConfirmBillOpen}
      loading={isLoading}
    >
      <p>Are you sure want to delete your Stripe account connection?</p>
    </Alert>
  );
}

export const DeleteStripeConnectionAlert = compose(
  withAlertStoreConnect(),
  withAlertActions,
)(DeleteStripeAccountAlert);
