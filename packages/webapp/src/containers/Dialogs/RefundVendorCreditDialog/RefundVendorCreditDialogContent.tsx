// @ts-nocheck
import React from 'react';

import '@/style/pages/RefundVendorCredit/RefundVendorCredit.scss';

import { RefundVendorCreditForm } from './RefundVendorCreditForm';
import { RefundVendorCreditFormProvider } from './RefundVendorCreditFormProvider';

export function RefundVendorCreditDialogContent({
  // #ownProps
  dialogName,
  vendorCreditId,
}) {
  return (
    <RefundVendorCreditFormProvider
      vendorCreditId={vendorCreditId}
      dialogName={dialogName}
    >
      <RefundVendorCreditForm />
    </RefundVendorCreditFormProvider>
  );
}
