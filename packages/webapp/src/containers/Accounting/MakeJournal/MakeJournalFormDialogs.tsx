// @ts-nocheck
import React from 'react';
import { useFormikContext } from 'formik';
import { index as JournalNumberDialog } from '@/containers/Dialogs/JournalNumberDialog';

/**
 * Make journal form dialogs.
 */
export function MakeJournalFormDialogs() {
  const { setFieldValue } = useFormikContext();

  // Update the form once the journal number form submit confirm.
  const handleConfirm = (settings) => {
    // Set the invoice transaction no. that cames from dialog to the form.
    // the `journalNumber` will be empty except the increment mode is not auto.
    setFieldValue('journalNumber', settings.transactionNumber);
    setFieldValue('journalNumberManually', '');

    if (settings.incrementMode !== 'auto') {
      setFieldValue('journalNumberManually', settings.transactionNumber);
    }
  };

  return (
    <JournalNumberDialog
      dialogName={'journal-number-form'}
      onConfirm={handleConfirm}
    />
  );
}
