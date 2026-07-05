// @ts-nocheck
import React from 'react';
import { NotifyReceiptViaSMSForm } from './NotifyReceiptViaSMSForm';
import { NotifyReceiptViaSMSFormProvider } from './NotifyReceiptViaSMSFormProvider';

export function NotifyReceiptViaSMSDialogContent({
  // #ownProps
  dialogName,
  receipt,
}) {
  return (
    <NotifyReceiptViaSMSFormProvider
      receiptId={receipt}
      dialogName={dialogName}
    >
      <NotifyReceiptViaSMSForm />
    </NotifyReceiptViaSMSFormProvider>
  );
}
