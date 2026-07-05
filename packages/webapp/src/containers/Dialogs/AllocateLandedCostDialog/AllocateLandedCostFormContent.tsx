// @ts-nocheck
import { Form, useFormikContext } from 'formik';
import React from 'react';
import { useAllocateLandedConstDialogContext } from './AllocateLandedCostDialogProvider';
import { AllocateLandedCostFloatingActions } from './AllocateLandedCostFloatingActions';
import { AllocateLandedCostFormFields } from './AllocateLandedCostFormFields';
import { FormObserver } from '@/components';

/**
 * Allocate landed cost form content.
 */
export function AllocateLandedCostFormContent() {
  const { values } = useFormikContext();

  // Allocate landed cost dialog context.
  const { setTransactionsType, setTransactionId, setTransactionEntryId } =
    useAllocateLandedConstDialogContext();

  // Handle the form change.
  const handleFormChange = (values) => {
    if (values.transaction_type) {
      setTransactionsType(values.transaction_type);
    }
    if (values.transaction_id) {
      setTransactionId(values.transaction_id);
    }
    if (values.transaction_entry_id) {
      setTransactionEntryId(values.transaction_entry_id);
    }
  };
  return (
    <Form>
      <AllocateLandedCostFormFields />
      <AllocateLandedCostFloatingActions />
      <FormObserver values={values} onChange={handleFormChange} />
    </Form>
  );
}
