// @ts-nocheck
import React from 'react';
import { NotifyPaymentReceiveViaFormProvider } from './NotifyPaymentReceiveViaFormProvider';
import { NotifyPaymentReceiveViaSMSForm } from './NotifyPaymentReceiveViaSMSForm';

export function NotifyPaymentReceiveViaSMSContent({
  // #ownProps
  dialogName,
  paymentReceive,
}) {
  return (
    <NotifyPaymentReceiveViaFormProvider
      paymentReceiveId={paymentReceive}
      dialogName={dialogName}
    >
      <NotifyPaymentReceiveViaSMSForm />
    </NotifyPaymentReceiveViaFormProvider>
  );
}
