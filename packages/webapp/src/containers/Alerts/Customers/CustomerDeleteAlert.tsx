// @ts-nocheck
import { Intent, Alert } from '@blueprintjs/core';
import React, { useCallback } from 'react';
import intl from 'react-intl-universal';
import {
  AppToaster,
  FormattedMessage as T,
  FormattedHTMLMessage,
} from '@/components';
import { DRAWERS } from '@/constants/drawers';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withAlertStoreConnect } from '@/containers/Alert/withAlertStoreConnect';
import { transformErrors } from '@/containers/Customers/utils';
import { withDrawerActions } from '@/containers/Drawer/withDrawerActions';
import { useDeleteCustomer } from '@/hooks/query';
import { compose } from '@/utils';

/**
 * Customer delete alert.
 */
function CustomerDeleteAlertInner({
  name,

  // #withAlertStoreConnect
  isOpen,
  payload: { contactId },

  // #withAlertActions
  closeAlert,

  // #withDrawerActions
  closeDrawer,
}) {
  const { mutateAsync: deleteCustomerMutate, isLoading } = useDeleteCustomer();

  // handle cancel delete  alert.
  const handleCancelDeleteAlert = () => {
    closeAlert(name);
  };

  // handle confirm delete customer.
  const handleConfirmDeleteCustomer = useCallback(() => {
    deleteCustomerMutate(contactId)
      .then(() => {
        AppToaster.show({
          message: intl.get('the_customer_has_been_deleted_successfully'),
          intent: Intent.SUCCESS,
        });
        closeDrawer(DRAWERS.CUSTOMER_DETAILS);
      })
      .catch(({ data: { errors } }) => {
        transformErrors(errors);
      })
      .finally(() => {
        closeAlert(name);
      });
  }, [deleteCustomerMutate, contactId, closeAlert, name]);

  return (
    <Alert
      cancelButtonText={<T id={'cancel'} />}
      confirmButtonText={<T id={'delete'} />}
      icon="trash"
      intent={Intent.DANGER}
      isOpen={isOpen}
      onCancel={handleCancelDeleteAlert}
      onConfirm={handleConfirmDeleteCustomer}
      loading={isLoading}
    >
      <p>
        <FormattedHTMLMessage
          id={'once_delete_this_customer_you_will_able_to_restore_it'}
        />
      </p>
    </Alert>
  );
}

export const CustomerDeleteAlert = compose(
  withAlertStoreConnect(),
  withAlertActions,
  withDrawerActions,
)(CustomerDeleteAlertInner);
