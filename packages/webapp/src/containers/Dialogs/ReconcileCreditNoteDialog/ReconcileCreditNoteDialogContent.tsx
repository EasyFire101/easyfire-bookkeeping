// @ts-nocheck
import React from 'react';
import { ReconcileCreditNoteForm } from './ReconcileCreditNoteForm';
import { ReconcileCreditNoteFormProvider } from './ReconcileCreditNoteFormProvider';

/**
 * Reconcile credit note dialog content.
 */
export function ReconcileCreditNoteDialogContent({
  // #ownProps
  dialogName,
  creditNoteId,
}) {
  return (
    <ReconcileCreditNoteFormProvider
      creditNoteId={creditNoteId}
      dialogName={dialogName}
    >
      <ReconcileCreditNoteForm />
    </ReconcileCreditNoteFormProvider>
  );
}
