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
import { handleDeleteErrors } from '@/containers/Purchases/CreditNotes/CreditNotesLanding/utils';
import { useDeleteVendorCredit } from '@/hooks/query';
import { compose } from '@/utils';

/**
 * Vendor Credit delete alert.
 */
function VendorCreditDeleteAlertInner({
  name,

  // #withAlertStoreConnect
  isOpen,
  payload: { vendorCreditId },

  // #withAlertActions
  closeAlert,

  // #withDrawerActions
  closeDrawer,
}) {
  const { isLoading, mutateAsync: deleteVendorCreditMutate } =
    useDeleteVendorCredit();

  // handle cancel delete credit note alert.
  const handleCancelDeleteAlert = () => {
    closeAlert(name);
  };
  const handleConfirmCreditDelete = () => {
    deleteVendorCreditMutate(vendorCreditId)
      .then(() => {
        AppToaster.show({
          message: intl.get('vendor_credits.alert.delete_message'),
          intent: Intent.SUCCESS,
        });
        closeDrawer(DRAWERS.VENDOR_CREDIT_DETAILS);
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
      onCancel={handleCancelDeleteAlert}
      onConfirm={handleConfirmCreditDelete}
      loading={isLoading}
    >
      <p>
        <FormattedHTMLMessage
          id={'vendor_credits.note.once_delete_this_vendor_credit_note'}
        />
      </p>
    </Alert>
  );
}

export const VendorCreditDeleteAlert = compose(
  withAlertStoreConnect(),
  withAlertActions,
  withDrawerActions,
)(VendorCreditDeleteAlertInner);
