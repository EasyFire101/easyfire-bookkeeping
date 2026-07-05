// @ts-nocheck
import { Intent, Alert } from '@blueprintjs/core';
import React from 'react';
import intl from 'react-intl-universal';
import { FormattedMessage as T } from '@/components';
import { AppToaster } from '@/components';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withAlertStoreConnect } from '@/containers/Alert/withAlertStoreConnect';
import { useBulkActivateAccounts } from '@/hooks/query/accounts';
import { compose } from '@/utils';

function AccountBulkActivateAlertInner({
  name,
  isOpen,
  payload: { accountsIds },

  // #withAlertActions
  closeAlert,
}) {
  const { mutateAsync: bulkActivate, isPending } = useBulkActivateAccounts();

  // Handle alert cancel.
  const handleClose = () => {
    closeAlert(name);
  };

  // Handle Bulk activate account confirm.
  const handleConfirmBulkActivate = async () => {
    try {
      await bulkActivate({ ids: accountsIds });
      AppToaster.show({
        message: intl.get('the_accounts_has_been_successfully_activated'),
        intent: Intent.SUCCESS,
      });
    } catch (error) {
      AppToaster.show({
        message: (error as Error)?.message,
        intent: Intent.DANGER,
      });
    } finally {
      closeAlert(name);
    }
  };

  return (
    <Alert
      cancelButtonText={<T id={'cancel'} />}
      confirmButtonText={`${intl.get('activate')} (${accountsIds.length})`}
      intent={Intent.WARNING}
      isOpen={isOpen}
      onCancel={handleClose}
      onConfirm={handleConfirmBulkActivate}
      loading={isPending}
    >
      <p>
        <T id={'are_sure_to_activate_this_accounts'} />
      </p>
    </Alert>
  );
}

export const AccountBulkActivateAlert = compose(
  withAlertStoreConnect(),
  withAlertActions,
)(AccountBulkActivateAlertInner);
