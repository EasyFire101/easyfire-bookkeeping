// @ts-nocheck
import React from 'react';
import { useFormikContext } from 'formik';
import { index as EstimateNumberDialog } from '@/containers/Dialogs/EstimateNumberDialog';
import { InvoiceExchangeRateChangeDialog } from '@/containers/Sales/Invoices/InvoiceForm/Dialogs/InvoiceExchangeRateChangeDialog';
import { DialogsName } from '@/constants/dialogs';

/**
 * Estimate form dialogs.
 */
export function EstimateFormDialogs() {
  const { setFieldValue } = useFormikContext();

  // Update the form once the estimate number form submit confirm.
  const handleEstimateNumberFormConfirm = (settings) => {
    setFieldValue('estimate_number', settings.transactionNumber);
    setFieldValue('estimate_number_manually', '');

    if (settings.incrementMode !== 'auto') {
      setFieldValue('estimate_number_manually', settings.transactionNumber);
    }
  };

  return (
    <>
      <EstimateNumberDialog
        dialogName={'estimate-number-form'}
        onConfirm={handleEstimateNumberFormConfirm}
      />
      <InvoiceExchangeRateChangeDialog
        dialogName={DialogsName.InvoiceExchangeRateChangeNotice}
      />
    </>
  );
}
