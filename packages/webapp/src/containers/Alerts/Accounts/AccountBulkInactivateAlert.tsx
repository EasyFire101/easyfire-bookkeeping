// @ts-nocheck
import { Intent, Alert } from '@blueprintjs/core';
import React from 'react';
import intl from 'react-intl-universal';
import { FormattedMessage as T } from '@/components';
import { AppToaster } from '@/components';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withAlertStoreConnect } from '@/containers/Alert/withAlertStoreConnect';
import { useBulkInactivateAccounts } from '@/hooks/query/accounts';
import { compose } from '@/utils';

function AccountBulkInactivateAlertInner({
  name,
  isOpen,
  payload: { accountsIds },

  // #withAlertActions
  closeAlert,
}) {
  const { mutateAsync: bulkInactivate, isPending } =
    useBulkInactivateAccounts();

  // Handle alert cancel.
  const handleCancel = () => {
    closeAlert(name);
  };

  // Handle Bulk Inactive accounts confirm.
  const handleConfirmBulkInactive = async () => {
    try {
      await bulkInactivate({ ids: accountsIds });
      AppToaster.show({
        message: intl.get('the_accounts_have_been_successfully_inactivated'),
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
      confirmButtonText={`${intl.get('inactivate')} (${accountsIds.length})`}
      intent={Intent.WARNING}
      isOpen={isOpen}
      onCancel={handleCancel}
      onConfirm={handleConfirmBulkInactive}
      loading={isPending}
    >
      <p>
        <T id={'are_sure_to_inactive_this_accounts'} />
      </p>
    </Alert>
  );
}

export const AccountBulkInactivateAlert = compose(
  withAlertStoreConnect(),
  withAlertActions,
)(AccountBulkInactivateAlertInner);
