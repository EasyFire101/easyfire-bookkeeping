// @ts-nocheck
import React from 'react';
import { ReconcileVendorCreditForm } from './ReconcileVendorCreditForm';
import { ReconcileVendorCreditFormProvider } from './ReconcileVendorCreditFormProvider';

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
