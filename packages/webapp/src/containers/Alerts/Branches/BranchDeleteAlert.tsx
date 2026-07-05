// @ts-nocheck
import { Intent, Alert } from '@blueprintjs/core';
import React from 'react';
import intl from 'react-intl-universal';
import {
  AppToaster,
  FormattedMessage as T,
  FormattedHTMLMessage,
} from '@/components';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withAlertStoreConnect } from '@/containers/Alert/withAlertStoreConnect';
import { handleDeleteErrors } from '@/containers/Preferences/Branches/utils';
import { useDeleteBranch } from '@/hooks/query';
import { compose } from '@/utils';

/**
 * Branch delete alert.
 */
function BranchDeleteAlertInner({
  name,

  // #withAlertStoreConnect
  isOpen,
  payload: { branchId },

  // #withAlertActions
  closeAlert,
}) {
  const { mutateAsync: deleteBranch, isLoading } = useDeleteBranch();

  // Handle cancel delete alert.
  const handleCancelDelete = () => {
    closeAlert(name);
  };

  // Handle confirm delete branch.
  const handleConfirmDeleteBranch = () => {
    deleteBranch(branchId)
      .then(() => {
        AppToaster.show({
          message: intl.get('branch.alert.delete_message'),
          intent: Intent.SUCCESS,
        });
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
      onCancel={handleCancelDelete}
      onConfirm={handleConfirmDeleteBranch}
      loading={isLoading}
    >
      <p>
        <FormattedHTMLMessage id={'branch.once_delete_this_branch'} />
      </p>
    </Alert>
  );
}

export const BranchDeleteAlert = compose(
  withAlertStoreConnect(),
  withAlertActions,
)(BranchDeleteAlertInner);
