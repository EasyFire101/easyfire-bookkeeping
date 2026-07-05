// @ts-nocheck
import { Intent, Alert } from '@blueprintjs/core';
import React from 'react';
import intl from 'react-intl-universal';
import { AppToaster, FormattedMessage as T } from '@/components';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withAlertStoreConnect } from '@/containers/Alert/withAlertStoreConnect';
import { useCancelUnlockingPartialTransactions } from '@/hooks/query';
import { compose } from '@/utils';

/**
 * Cancel Unlocking partial transactions alerts.
 */
function CancelUnlockingPartialTarnsactions({
  name,

  // #withAlertStoreConnect
  isOpen,
  payload: { module },

  // #withAlertActions
  closeAlert,
}) {
  const { mutateAsync: cancelUnlockingPartial, isLoading } =
    useCancelUnlockingPartialTransactions();

  // Handle cancel.
  const handleCancel = () => {
    closeAlert(name);
  };

  // Handle confirm.
  const handleConfirm = () => {
    const values = {
      module: module,
    };
    cancelUnlockingPartial(values)
      .then(() => {
        AppToaster.show({
          message: intl.get(
            'unlocking_partial_transactions.alert.cancel_message',
          ),
          intent: Intent.SUCCESS,
        });
      })
      .catch(({ data: { errors } }) => {})
      .finally(() => {
        closeAlert(name);
      });
  };

  return (
    <Alert
      cancelButtonText={<T id={'cancel'} />}
      confirmButtonText={<T id={'yes'} />}
      intent={Intent.DANGER}
      isOpen={isOpen}
      onCancel={handleCancel}
      onConfirm={handleConfirm}
      loading={isLoading}
    >
      <p>
        <T id={'unlocking_partial_transactions.alert.message'} />
      </p>
    </Alert>
  );
}

export const cancelUnlockingPartialAlert = compose(
  withAlertStoreConnect(),
  withAlertActions,
)(CancelUnlockingPartialTarnsactions);
