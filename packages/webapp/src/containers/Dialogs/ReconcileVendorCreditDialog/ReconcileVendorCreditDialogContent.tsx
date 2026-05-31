// @ts-nocheck
import React from 'react';
import { ReconcileVendorCreditFormProvider } from './ReconcileVendorCreditFormProvider';
import { ReconcileVendorCreditForm } from './ReconcileVendorCreditForm';

export function ReconcileVendorCreditDialogContent({
  // #ownProps
  dialogName,
  vendorCreditId,
}) {
  return (
    <ReconcileVendorCreditFormProvider
      vendorCreditId={vendorCreditId}
      dialogName={dialogName}
    >
      <ReconcileVendorCreditForm />
    </ReconcileVendorCreditFormProvider>
  );
}
