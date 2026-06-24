// @ts-nocheck
import React from 'react';
import { useFormikContext } from 'formik';
import { index as ReceiptNumberDialog } from '@/containers/Dialogs/ReceiptNumberDialog';
import { InvoiceExchangeRateChangeDialog } from '@/containers/Sales/Invoices/InvoiceForm/Dialogs/InvoiceExchangeRateChangeDialog';
import { DialogsName } from '@/constants/dialogs';

/**
 * Receipt form dialogs.
 */
export function ReceiptFormDialogs() {
  const { setFieldValue } = useFormikContext();

  // Update the form once the receipt number form submit confirm.
  const handleReceiptNumberFormConfirm = (settings) => {
    // Set the receipt transaction no. that cames from dialog to the form.
    // the `receipt_no_manually` will be empty except the increment mode is not auto.
    setFieldValue('receipt_number', settings.transactionNumber);
    setFieldValue('receipt_number_manually', '');

    if (settings.incrementMode !== 'auto') {
      setFieldValue('receipt_number_manually', settings.transactionNumber);
    }
  };

  return (
    <>
      <ReceiptNumberDialog
        dialogName={'receipt-number-form'}
        onConfirm={handleReceiptNumberFormConfirm}
      />
      <InvoiceExchangeRateChangeDialog
        dialogName={DialogsName.InvoiceExchangeRateChangeNotice}
      />
    </>
  );
}
