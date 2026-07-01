import React from 'react';
import { useFormikContext } from 'formik';

import { index as TransactionNumberDialog } from '@/containers/Dialogs/TransactionNumberDialog';
import type { MoneyInFormValues } from './types';

interface TransactionNumberSettings {
  transactionNumber: string;
}

/**
 * Money in / transaction number form dialog.
 */
export function MoneyInFormDialog() {
  const { setFieldValue } = useFormikContext<MoneyInFormValues>();

  // Update the form once the transaction number form submit confirm.
  const handleTransactionNumberFormConfirm = (
    settings: TransactionNumberSettings,
  ) => {
    setFieldValue('transactionNumber', settings.transactionNumber);
    setFieldValue('transactionNumberManually', settings.transactionNumber);
  };
  return (
    <React.Fragment>
      <TransactionNumberDialog
        dialogName={'transaction-number-form'}
        onConfirm={handleTransactionNumberFormConfirm}
      />
    </React.Fragment>
  );
}
