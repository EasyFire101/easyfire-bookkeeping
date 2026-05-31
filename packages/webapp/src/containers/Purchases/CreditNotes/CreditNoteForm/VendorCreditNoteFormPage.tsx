// @ts-nocheck
import React from 'react';
import { useParams } from 'react-router-dom';

import { VendorCreditNoteForm } from './VendorCreditNoteForm';
import { VendorCreditNoteFormProvider } from './VendorCreditNoteFormProvider';

/**
 * Vendor Credit note form pages.
 */
export function VendorCreditNoteFormPage() {
  const { id } = useParams();
  const idAsInteger = id ? parseInt(id, 10) : undefined;

  return (
    <VendorCreditNoteFormProvider vendorCreditId={idAsInteger}>
      <VendorCreditNoteForm />
    </VendorCreditNoteFormProvider>
  );
}
