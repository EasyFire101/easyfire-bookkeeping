// @ts-nocheck
import { Form } from 'formik';
import React from 'react';
import { RefundCreditNoteFloatingActions } from './RefundCreditNoteFloatingActions';
import { RefundCreditNoteFormFields } from './RefundCreditNoteFormFields';

/**
 * Refund credit note form content.
 */
export function RefundCreditNoteFormContent() {
  return (
    <Form>
      <RefundCreditNoteFormFields />
      <RefundCreditNoteFloatingActions />
    </Form>
  );
}
