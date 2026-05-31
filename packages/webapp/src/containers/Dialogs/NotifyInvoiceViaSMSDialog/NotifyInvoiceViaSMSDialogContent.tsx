// @ts-nocheck
import React from 'react';

import { NotifyInvoiceViaSMSFormProvider } from './NotifyInvoiceViaSMSFormProvider';
import { NotifyInvoiceViaSMSForm } from './NotifyInvoiceViaSMSForm';

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
