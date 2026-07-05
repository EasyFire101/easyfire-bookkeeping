// @ts-nocheck
import React from 'react';

import '@/style/pages/RefundCreditNote/RefundCreditNote.scss';
import { RefundCreditNoteForm } from './RefundCreditNoteForm';
import { RefundCreditNoteFormProvider } from './RefundCreditNoteFormProvider';

/**
 * Refund credit note dialog content.
 */
export function RefundCreditNoteDialogContent({
  // #ownProps
  dialogName,
  creditNoteId,
}) {
  return (
    <RefundCreditNoteFormProvider
      creditNoteId={creditNoteId}
      dialogName={dialogName}
    >
      <RefundCreditNoteForm />
    </RefundCreditNoteFormProvider>
  );
}
