// @ts-nocheck
import React from 'react';

import '@/style/pages/PaymentReceive/QuickPaymentReceiveDialog.scss';

import { QuickPaymentReceiveForm } from './QuickPaymentReceiveForm';
import { QuickPaymentReceiveFormProvider } from './QuickPaymentReceiveFormProvider';

/**
 * Quick payment receive form dialog content.
 */
export function QuickPaymentReceiveFormDialogContent({
  // #ownProps
  dialogName,
  invoice,
}) {
  return (
    <QuickPaymentReceiveFormProvider
      invoiceId={invoice}
      dialogName={dialogName}
    >
      <QuickPaymentReceiveForm />
    </QuickPaymentReceiveFormProvider>
  );
}
