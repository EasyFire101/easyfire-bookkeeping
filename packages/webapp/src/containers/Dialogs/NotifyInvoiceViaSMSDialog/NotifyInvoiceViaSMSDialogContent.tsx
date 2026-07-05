// @ts-nocheck
import React from 'react';
import { NotifyInvoiceViaSMSForm } from './NotifyInvoiceViaSMSForm';
import { NotifyInvoiceViaSMSFormProvider } from './NotifyInvoiceViaSMSFormProvider';

export function NotifyInvoiceViaSMSDialogContent({
  // #ownProps
  dialogName,
  invoiceId,
}) {
  return (
    <NotifyInvoiceViaSMSFormProvider
      invoiceId={invoiceId}
      dialogName={dialogName}
    >
      <NotifyInvoiceViaSMSForm />
    </NotifyInvoiceViaSMSFormProvider>
  );
}
