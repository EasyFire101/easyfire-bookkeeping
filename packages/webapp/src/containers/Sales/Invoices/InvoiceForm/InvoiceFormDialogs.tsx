// @ts-nocheck
import { useFormikContext } from 'formik';
import { index as InvoiceNumberDialog } from '@/containers/Dialogs/InvoiceNumberDialog';
import { InvoiceExchangeRateChangeDialog } from '@/containers/Sales/Invoices/InvoiceForm/Dialogs/InvoiceExchangeRateChangeDialog';
import { DialogsName } from '@/constants/dialogs';

/**
 * Invoice form dialogs.
 */
export function InvoiceFormDialogs() {
  const { setFieldValue } = useFormikContext();

  // Update the form once the invoice number form submit confirm.
  const handleInvoiceNumberFormConfirm = (settings) => {
    // Set the invoice transaction no. that cames from dialog to the form.
    // the `invoice_no_manually` will be empty except the increment mode is not auto.
    setFieldValue('invoice_no', settings.transactionNumber);
    setFieldValue('invoice_no_manually', '');

    if (settings.incrementMode !== 'auto') {
      setFieldValue('invoice_no_manually', settings.transactionNumber);
    }
  };

  return (
    <>
      <InvoiceNumberDialog
        dialogName={DialogsName.InvoiceNumberSettings}
        onConfirm={handleInvoiceNumberFormConfirm}
      />
      <InvoiceExchangeRateChangeDialog
        dialogName={DialogsName.InvoiceExchangeRateChangeNotice}
      />
    </>
  );
}
