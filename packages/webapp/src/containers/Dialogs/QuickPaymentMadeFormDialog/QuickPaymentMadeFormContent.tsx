// @ts-nocheck
import React from 'react';
import { Form } from 'formik';
import { QuickPaymentMadeFormFields } from './QuickPaymentMadeFormFields';
import { QuickPaymentMadeFloatingActions } from './QuickPaymentMadeFloatingActions';
/**
 * Quick payment made form content.
 */
export function QuickPaymentMadeFormContent() {
  return (
    <Form>
      <QuickPaymentMadeFormFields />
      <QuickPaymentMadeFloatingActions />
    </Form>
  );
}
